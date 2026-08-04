const express = require('express')
const router = express.Router()
const Order = require('../models/Order')
const { protect } = require('../middleware/authMiddleware')

// CREATE a new order
router.post('/', protect, async (req, res) => {
  try {
    const newOrder = new Order(req.body)
    const savedOrder = await newOrder.save()
    res.status(201).json(savedOrder)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

// GET all orders for a specific user
router.get('/user/:userId', async (req, res) => {
  try {
    const orders = await Order.find({ user: req.params.userId }).sort({ createdAt: -1 })
    res.json(orders)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router