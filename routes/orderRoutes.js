const express = require('express')
const router = express.Router()
const Order = require('../models/Order')
const Product = require('../models/Product')
const { protect, adminOnly } = require('../middleware/authMiddleware')

// CREATE a new order
router.post('/', protect, async (req, res) => {
  try {
    const { items } = req.body

    if (!items || items.length === 0) {
      return res.status(400).json({ message: 'No items in order' })
    }

    let totalAmount = 0
    const verifiedItems = []

    for (const item of items) {
      const product = await Product.findById(item.product)
      if (!product) {
        return res.status(400).json({ message: `Product not found: ${item.product}` })
      }

      const itemTotal = product.price * item.quantity
      totalAmount += itemTotal

      verifiedItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
      })
    }

    const newOrder = new Order({
      user: req.userId,
      items: verifiedItems,
      totalAmount,
    })

    const savedOrder = await newOrder.save()
    res.status(201).json(savedOrder)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

// GET all orders for a specific user
router.get('/user/:userId', protect, async (req, res) => {
  try {
    if (req.userId !== req.params.userId) {
      return res.status(403).json({ message: 'Not authorized to view these orders' })
    }
    const orders = await Order.find({ user: req.params.userId }).sort({ createdAt: -1 })
    res.json(orders)
  } catch (err) {
    res.status(500).json({ message: err.message })
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