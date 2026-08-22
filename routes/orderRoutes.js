const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const Order = require('../models/Order')
const Product = require('../models/Product')
const User = require('../models/User')
const { protect, adminOnly } = require('../middleware/authMiddleware')

// CREATE a new order
router.post('/', protect, async (req, res) => {
  const clientRequestId = String(req.get('Idempotency-Key') || '').trim()
  if (!clientRequestId || clientRequestId.length > 100) {
    return res.status(400).json({ message: 'A valid Idempotency-Key is required' })
  }

  const session = await Order.startSession()
  try {
    const { items, shippingAddress } = req.body

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ message: 'No items in order' })
    }

    const requiredAddressFields = ['fullName', 'phone', 'addressLine1', 'city', 'state', 'postcode']
    const missingField = requiredAddressFields.find((field) => !shippingAddress?.[field]?.trim())
    if (missingField) {
      return res.status(400).json({ message: `Shipping address is missing: ${missingField}` })
    }

    let savedOrder
    let wasDuplicate = false
    await session.withTransaction(async () => {
      const existing = await Order.findOne({ clientRequestId }).session(session)
      if (existing) {
        savedOrder = existing
        wasDuplicate = true
        return
      }

      let totalAmount = 0
      const verifiedItems = []

      for (const item of items) {
        const quantity = Number(item.quantity)
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
          throw Object.assign(new Error('Invalid item quantity'), { status: 400 })
        }
        const product = await Product.findById(item.product).session(session)
        if (!product) throw Object.assign(new Error('A product in the order was not found'), { status: 400 })
        const variantId = item.variant || item.variantId
        const variant = variantId ? product.variants.id(variantId) : null
        if (variantId && !variant) throw Object.assign(new Error(`Selected option for ${product.name} is no longer available`), { status: 409 })

        const sellable = variant || product
        const stock = sellable.stock
        if (variant && (!variant.isAvailable || stock < quantity)) {
          throw Object.assign(new Error(`${product.name} — ${variant.packSize} is unavailable`), { status: 409 })
        }
        if (!variant && stock !== undefined && stock < quantity) {
          throw Object.assign(new Error(`${product.name} does not have enough stock`), { status: 409 })
        }
        if (stock !== undefined) {
          sellable.stock -= quantity
          await product.save({ session })
        }

        totalAmount += sellable.price * quantity
        verifiedItems.push({
          product: product._id,
          ...(variant && { variant: variant._id, packSize: variant.packSize, sku: variant.sku, image: variant.image || product.image }),
          name: product.name,
          price: sellable.price,
          quantity,
        })
      }

      ;[savedOrder] = await Order.create([{
        user: req.userId,
        items: verifiedItems,
        shippingAddress,
        totalAmount,
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

// GET all orders for a specific user
router.get('/user/:userId', protect, async (req, res) => {
  try {
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
    const orders = await Order.find().populate('user', 'name email').sort({ createdAt: -1 })
    res.json(orders)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// UPDATE order status (admin only)
router.put('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['pending', 'paid', 'shipped', 'delivered']
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true })
    if (!order) {
      return res.status(404).json({ message: 'Order not found' })
    }
    res.json(order)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
