const mongoose = require('mongoose')
const Order = require('../models/Order')
const Product = require('../models/Product')

const DEFAULT_EXPIRY_MINUTES = 30

async function releaseOrderStock(order, session) {
  if (!order.stockReserved) return false
  const productIds = [...new Set(order.items.map((item) => String(item.product)))]
  const products = await Product.find({ _id: { $in: productIds } }).session(session)
  const productsById = new Map(products.map((product) => [String(product._id), product]))
  const changed = new Set()
  for (const item of order.items) {
    const product = productsById.get(String(item.product))
    if (!product) continue
    const sellable = item.variant ? product.variants.id(item.variant) : product
    if (!sellable || !Number.isSafeInteger(sellable.stock)) continue
    sellable.stock += item.quantity
    changed.add(product)
  }
  for (const product of changed) await product.save({ session })
  order.stockReserved = false
  await order.save({ session })
  return true
}

async function cancelPendingOrder(orderId, { before, note, userId } = {}) {
  const session = await mongoose.startSession()
  let result = null
  try {
    await session.withTransaction(async () => {
      const filter = { _id: orderId, status: 'pending', stockReserved: true }
      if (before) filter.createdAt = { $lte: before }
      if (userId) filter.user = userId
      const order = await Order.findOneAndUpdate(filter, {
        $set: { status: 'cancelled', statusNote: note || 'Payment was not completed before the reservation expired.' },
      }, { new: true, session })
      if (!order) return
      // Restore inventory in the same transaction as the conditional state change.
      await releaseOrderStock(order, session)
      result = order
    })
    return result
  } finally {
    await session.endSession()
  }
}

async function expirePendingOrders() {
  const configured = Number(process.env.PENDING_ORDER_EXPIRY_MINUTES)
  const minutes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EXPIRY_MINUTES
  const before = new Date(Date.now() - minutes * 60 * 1000)
  const candidates = await Order.find({ status: 'pending', stockReserved: true, createdAt: { $lte: before } })
    .select('_id').sort({ createdAt: 1 }).limit(100).lean()
  let expired = 0
  for (const candidate of candidates) {
    if (await cancelPendingOrder(candidate._id, { before, note: `Payment reservation expired after ${minutes} minutes.` })) expired += 1
  }
  return expired
}

module.exports = { releaseOrderStock, cancelPendingOrder, expirePendingOrders }
