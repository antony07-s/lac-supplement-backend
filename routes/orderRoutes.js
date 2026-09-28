const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const { randomUUID } = require('crypto')
const Order = require('../models/Order')
const Product = require('../models/Product')
const User = require('../models/User')
const { protect, adminOnly } = require('../middleware/authMiddleware')
const { PAYPAL_BASE, getPayPalAccessToken } = require('../utils/paypal')
const { calculateCheckout, moneyToSen } = require('../utils/checkout')
const { sendOrderPaidEmails, sendOrderShippedEmail, sendOrderDeliveredEmail } = require('../utils/notify')
const { releaseOrderStock, cancelPendingOrder } = require('../utils/orderInventory')

async function recordShipmentEmail(order) {
  const buyer = await User.findById(order.user).select('email').lean()
  const result = await sendOrderShippedEmail(order, buyer?.email)
  order.shipmentEmailStatus = result.ok ? 'sent' : 'failed'
  order.shipmentEmailSentAt = result.ok ? new Date() : null
  order.shipmentEmailLastError = result.ok ? '' : String(result.error || 'Unable to send shipment email').slice(0, 500)
  await order.save()
  return result
}


function cleanAddress(address) {
  const fields = ['fullName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postcode', 'country']
  const cleaned = Object.fromEntries(fields.map((field) => [field, String(address?.[field] || '').trim()]))
  cleaned.country ||= 'Malaysia'
  const missing = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postcode'].find((field) => !cleaned[field])
  if (missing) throw Object.assign(new Error(`Shipping address is missing: ${missing}`), { status: 400 })
  if (Object.values(cleaned).some((value) => value.length > 200)) throw Object.assign(new Error('Shipping address contains an invalid value'), { status: 400 })
  const validPostcode = cleaned.country === 'India' ? /^\d{6}$/.test(cleaned.postcode) : cleaned.country === 'Malaysia' && /^\d{5}$/.test(cleaned.postcode)
  if (!validPostcode) throw Object.assign(new Error('Enter a valid postcode for the selected country'), { status: 400 })
  if (!/^[+\d()\-\s]{7,25}$/.test(cleaned.phone)) throw Object.assign(new Error('Enter a valid phone number'), { status: 400 })
  return cleaned
}

async function verifyItems(items, session) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) throw Object.assign(new Error('No items in order'), { status: 400 })
  for (const item of items) {
    if (!mongoose.isValidObjectId(item?.product) || ((item.variant || item.variantId) && !mongoose.isValidObjectId(item.variant || item.variantId))) {
      throw Object.assign(new Error('Invalid product option'), { status: 400 })
    }
    const quantity = Number(item.quantity)
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) throw Object.assign(new Error('Invalid item quantity'), { status: 400 })
  }
  const query = Product.find({ _id: { $in: [...new Set(items.map((item) => String(item.product)))] } })
  if (session) query.session(session)
  const products = await query
  const productsById = new Map(products.map((product) => [String(product._id), product]))
  const verified = []
  for (const item of items) {
    const quantity = Number(item.quantity)
    const product = productsById.get(String(item.product))
    if (!product) throw Object.assign(new Error('A product in the order was not found'), { status: 400 })
    const variant = (item.variant || item.variantId) ? product.variants.id(item.variant || item.variantId) : null
    if ((item.variant || item.variantId) && !variant) throw Object.assign(new Error(`Selected option for ${product.name} is no longer available`), { status: 409 })
    const sellable = variant || product
    if (!Number.isSafeInteger(sellable.stock) || sellable.stock < 0) throw Object.assign(new Error(`${product.name} needs a valid stock quantity for checkout`), { status: 409 })
    if (sellable.stock < quantity) throw Object.assign(new Error(`${product.name} is unavailable in the requested quantity`), { status: 409 })
    if (variant && !variant.isAvailable) throw Object.assign(new Error(`${product.name} is unavailable in the requested quantity`), { status: 409 })
    const weightKg = Number(sellable.shippingWeightKg)
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw Object.assign(new Error(`${product.name} needs a valid shipping weight for checkout`), { status: 409 })
    const orderItem = { product: product._id, image: variant?.image || product.image, ...(variant && { variant: variant._id, packSize: variant.packSize, sku: variant.sku }), name: product.name, price: sellable.price, weightKg, quantity }
    verified.push({ product, sellable, quantity, orderItem })
  }
  return verified
}

// CREATE a new order
router.post('/', protect, async (req, res) => {
  const clientRequestId = String(req.get('Idempotency-Key') || '').trim()
  if (!clientRequestId || clientRequestId.length > 100) {
    return res.status(400).json({ message: 'A valid Idempotency-Key is required' })
  }

  const session = await Order.startSession()
  try {
    const { items, shippingAddress } = req.body
    const address = cleanAddress(shippingAddress)

    let savedOrder
    let wasDuplicate = false
    await session.withTransaction(async () => {
      const existing = await Order.findOne({ clientRequestId }).session(session)
      if (existing) {
        // Idempotency keys are client supplied. Never return another buyer's
        // order if an improbable key collision (or a malicious replay) occurs.
        if (String(existing.user) !== req.userId) {
          throw Object.assign(new Error('This checkout request conflicts with an existing order'), { status: 409 })
        }
        savedOrder = existing
        wasDuplicate = true
        return
      }

      const verifiedItems = []
      const verified = await verifyItems(items, session)
      const productsToSave = new Map()
      for (const { product, sellable, quantity, orderItem } of verified) {
        if (sellable.stock < quantity) throw Object.assign(new Error(`${product.name} does not have enough stock`), { status: 409 })
        sellable.stock -= quantity
        productsToSave.set(String(product._id), product)
        verifiedItems.push(orderItem)
      }
      for (const product of productsToSave.values()) await product.save({ session })

      const checkout = calculateCheckout({ items: verifiedItems, state: address.state, country: address.country })

      ;[savedOrder] = await Order.create([{
        user: req.userId,
        items: verifiedItems,
        shippingAddress: address,
        ...checkout,
        clientRequestId,
      }], { session })
    })
    res.status(wasDuplicate ? 200 : 201).json(savedOrder)
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Order.findOne({ clientRequestId })
      if (existing) return res.status(200).json(existing)
    }
    res.status(err.status || 400).json({ message: err.status ? err.message : 'Unable to place order' })
  } finally {
    await session.endSession()
  }
})

router.post('/quote', protect, async (req, res) => {
  try {
    const address = cleanAddress(req.body.shippingAddress)
    const verified = await verifyItems(req.body.items)
    res.json(calculateCheckout({ items: verified.map((entry) => entry.orderItem), state: address.state, country: address.country }))
  } catch (err) {
    res.status(err.status || 400).json({ message: err.status ? err.message : 'Unable to calculate checkout total' })
  }
})

// CREATE a PayPal Order for an existing pending order.
// The order and stock reservation are already handled by the POST / route.
// Unlike a redirect checkout, PayPal returns an order ID for the frontend
// uses this orderId with PayPal's JS SDK to render the buyer approval flow,
// then calls the capture route (added separately) once approved.
router.post('/:id/paypal-order', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID' })
    }
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to pay for this order' })
    }
    if (order.status !== 'pending') {
      return res.status(409).json({ message: `This order is already ${order.status} and cannot be paid again.` })
    }
    if (order.razorpayOrderId || (order.paymentProvider && order.paymentProvider !== 'paypal')) {
      return res.status(409).json({ message: 'A different payment method has already been started for this order.' })
    }
    if (order.paypalOrderId) return res.json({ orderId: order.paypalOrderId })

    // Persist PayPal's idempotency key before contacting it. Retries (including
    // a browser retry after a lost response) reuse the same provider order.
    let requestId = order.paypalCreateRequestId
    if (!requestId) {
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending', paypalCreateRequestId: { $exists: false }, paymentProvider: { $in: [null, 'paypal'] } },
        { $set: { paypalCreateRequestId: randomUUID(), paymentProvider: 'paypal' } },
        { new: true },
      )
      const current = claimed || await Order.findById(order._id)
      if (!current || current.status !== 'pending') return res.status(409).json({ message: 'This order can no longer be paid' })
      if (current.paypalOrderId) return res.json({ orderId: current.paypalOrderId })
      requestId = current.paypalCreateRequestId
    }
    const accessToken = await getPayPalAccessToken()

    const ppRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': requestId,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: String(order._id),
            amount: {
              currency_code: 'MYR',
              value: order.totalAmount.toFixed(2),
            },
          },
        ],
      }),
    })

    if (!ppRes.ok) {
      console.error('PayPal order creation failed:', ppRes.status)
      return res.status(500).json({ message: 'Unable to start PayPal payment. Please try again.' })
    }

    const ppData = await ppRes.json()
    if (!ppData.id) return res.status(502).json({ message: 'PayPal returned an invalid order response' })
    await Order.findOneAndUpdate({ _id: order._id, status: 'pending' }, { paypalOrderId: ppData.id, paymentProvider: 'paypal' })
    res.json({ orderId: ppData.id })
  } catch (err) {
    console.error('PayPal order error:', err.message)
    res.status(500).json({ message: 'Unable to start payment. Please try again.' })
  }
})

// CAPTURE a PayPal payment after the buyer approves it on the frontend.
// PayPal splits payment into two steps: create order, then capture after
// buyer approval. This route verifies the completed capture with PayPal.
router.post('/:id/paypal-capture', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID' })
    }
    const paypalOrderId = String(req.body.paypalOrderId || '').trim()
    if (!/^[A-Z0-9]{10,40}$/i.test(paypalOrderId)) {
      return res.status(400).json({ message: 'Missing PayPal order ID' })
    }

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to pay for this order' })
    }
    if (order.status !== 'pending') {
      return res.status(409).json({ message: `This order is already ${order.status} and cannot be paid again.` })
    }
    if (order.paypalOrderId !== paypalOrderId) return res.status(409).json({ message: 'This PayPal order does not belong to this checkout' })

    const accessToken = await getPayPalAccessToken()

    // Never accept the browser's approval as proof of payment. Read the
    // server-side PayPal order first and bind its reference, currency and
    // exact backend-calculated amount to this internal order.
    const detailsRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!detailsRes.ok) return res.status(502).json({ message: 'Unable to verify the PayPal payment. Please try again.' })
    const details = await detailsRes.json()
    const unit = details.purchase_units?.[0]
    if (details.status !== 'APPROVED' || unit?.reference_id !== String(order._id) || unit?.amount?.currency_code !== 'MYR' || moneyToSen(unit?.amount?.value) !== moneyToSen(order.totalAmount)) {
      return res.status(409).json({ message: 'PayPal payment details do not match this order' })
    }

    const captureRes = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!captureRes.ok) {
      console.error('PayPal capture failed:', captureRes.status)
      return res.status(500).json({ message: 'Payment could not be completed. Please try again.' })
    }

    const captureData = await captureRes.json()
    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0]
    const isCompleted = captureData.status === 'COMPLETED' && capture?.status === 'COMPLETED' && capture?.amount?.currency_code === 'MYR' && moneyToSen(capture?.amount?.value) === moneyToSen(order.totalAmount)

    let paidOrder = null
    let currentOrder = order
    if (isCompleted) {
      paidOrder = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending', stockReserved: true, paypalOrderId },
        { $set: { status: 'paid', paypalCaptureId: capture.id, paymentProvider: 'paypal' } },
        { new: true },
      )
      currentOrder = paidOrder || await Order.findById(order._id)
      if (!paidOrder) console.error(`PayPal capture ${capture.id} completed for order ${order._id} after its status changed to ${currentOrder?.status || 'missing'}; reconcile payment manually.`)
    }

    // Respond to the browser FIRST. The buyer should see "payment successful"
    // immediately, without waiting on email sending (which can be slow or fail).
    res.json({ status: currentOrder.status, paypal: captureData.status })

    // Fire-and-forget notification block - runs AFTER the response is sent.
    if (paidOrder) {
      User.findById(paidOrder.user)
        .select('email')
        .lean()
        .then((buyer) => sendOrderPaidEmails(paidOrder, buyer?.email))
        .catch((err) => console.error('Order notification error:', err.message))
    }
  } catch (err) {
    console.error('PayPal capture error:', err.message)
    res.status(500).json({ message: 'Unable to complete payment. Please try again.' })
  }
})

// A cancelled buyer approval must release the reservation exactly once. This
// also gives the UI a safe recovery path after a timeout or network failure.
router.post('/:id/cancel-payment', protect, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID' })
  try {
    const cancelled = await cancelPendingOrder(req.params.id, { userId: req.userId, note: 'Payment was cancelled by the customer.' })
    const order = cancelled || await Order.findOne({ _id: req.params.id, user: req.userId }).select('status').lean()
    if (!order) return res.status(404).json({ message: 'Order not found' })
    res.json({ status: order.status })
  } catch (err) {
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Unable to cancel this payment' })
  }
})

// GET all orders for a specific user
router.get('/user/:userId', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return res.status(400).json({ message: 'Invalid user ID' })
    if (req.userId !== req.params.userId) {
      return res.status(403).json({ message: 'Not authorized to view these orders' })
    }
    const orders = await Order.find({ user: req.params.userId }).sort({ createdAt: -1 }).lean()
    res.json(orders)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET a single order for its owner (or an administrator)
router.get('/:id', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order ID' })
    }
    const order = await Order.findById(req.params.id).lean()
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== req.userId) {
      const requester = await User.findById(req.userId).select('isAdmin').lean()
      if (!requester?.isAdmin) return res.status(403).json({ message: 'Not authorized to view this order' })
    }
    res.json(order)
  } catch (err) {
    res.status(500).json({ message: 'Unable to load order' })
  }
})

// GET all orders (admin only)
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
    const fields = '_id user items shippingAddress totalAmount subtotal discount shipping totalWeightKg shippingRegion status statusNote courierName trackingNumber shippedAt deliveredAt fulfilmentNote shipmentEmailStatus shipmentEmailSentAt shipmentEmailLastError createdAt updatedAt __v'
    const [orders, total] = await Promise.all([
      Order.find().select(fields).populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(),
    ])
    res.set('X-Total-Count', String(total))
    res.set('X-Page', String(page))
    res.set('X-Page-Size', String(limit))
    res.json(orders)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// UPDATE order status (admin only)
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID' })
    const { status, courierName, trackingNumber, fulfilmentNote, statusNote } = req.body
    if (!['shipped', 'delivered', 'cancelled', 'refunded'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    if (status === 'cancelled' || status === 'refunded') {
      const note = String(statusNote || '').trim()
      if (!note || note.length > 1000) return res.status(400).json({ message: 'A note of up to 1000 characters is required' })
      const session = await mongoose.startSession()
      let updated
      try {
        await session.withTransaction(async () => {
          const current = await Order.findById(req.params.id).session(session)
          if (!current) throw Object.assign(new Error('Order not found'), { status: 404 })
          const allowed = status === 'cancelled'
            ? ['pending', 'paid'].includes(current.status)
            : ['paid', 'shipped', 'delivered'].includes(current.status)
          if (!allowed) throw Object.assign(new Error('Order status transition is not allowed'), { status: 409 })
          updated = await Order.findOneAndUpdate(
            { _id: current._id, status: current.status },
            { $set: { status, statusNote: note } },
            { new: true, session },
          )
          if (!updated) throw Object.assign(new Error('Order status changed; reload and try again'), { status: 409 })
          if (status === 'cancelled') await releaseOrderStock(updated, session)
        })
      } catch (err) {
        return res.status(err.status || 500).json({ message: err.status ? err.message : 'Unable to update order status' })
      } finally {
        await session.endSession()
      }
      return res.json(updated)
    }
    const order = await Order.findById(req.params.id)
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }
    if ((status === 'shipped' && order.status !== 'paid') || (status === 'delivered' && order.status !== 'shipped')) {
      return res.status(409).json({ message: 'Order status transition is not allowed' })
    }

    if (status === 'shipped') {
      const cleanCourier = String(courierName || '').trim()
      const cleanTracking = String(trackingNumber || '').trim()
      if (!cleanCourier || !cleanTracking || cleanTracking.length > 60) {
        return res.status(400).json({ message: 'Courier name and tracking number are required' })
      }
      order.courierName = cleanCourier
      order.trackingNumber = cleanTracking
      order.shippedAt = new Date()
      order.fulfilmentNote = String(fulfilmentNote || '').trim().slice(0, 1000)
    }

    if (status === 'delivered') order.deliveredAt = new Date()

    order.status = status
    await order.save()
    res.json(order)

    // Fire-and-forget shipped-notification email, same pattern used for
    // the PayPal capture email in this file — never blocks the response.
    if (status === 'shipped') {
      recordShipmentEmail(order)
        .catch((err) => console.error('Shipped notification error:', err.message))
    }
    if (status === 'delivered') {
      User.findById(order.user)
        .select('email')
        .lean()
        .then((buyer) => {
          if (buyer?.email) return sendOrderDeliveredEmail(order, buyer.email)
        })
        .catch((err) => console.error('Delivered notification error:', err.message))
    }
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/:id/shipment-email/retry', protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID' })
    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (!['shipped', 'delivered'].includes(order.status)) return res.status(409).json({ message: 'Only shipped orders can receive a shipment email' })
    const result = await recordShipmentEmail(order)
    if (!result.ok) return res.status(502).json({ message: 'Shipment email could not be sent', detail: order.shipmentEmailLastError })
    res.json({ shipmentEmailStatus: order.shipmentEmailStatus, shipmentEmailSentAt: order.shipmentEmailSentAt })
  } catch (err) {
    res.status(500).json({ message: 'Unable to retry shipment email' })
  }
})

module.exports = router
