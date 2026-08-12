const express = require('express')
const router = express.Router()
const Cart = require('../models/Cart')
const { protect } = require('../middleware/authMiddleware')

router.get('/', protect, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.userId }).populate('items.product')
    res.json(cart ? cart.items.map((item) => ({ ...item.product.toObject(), quantity: item.quantity })) : [])
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/', protect, async (req, res) => {
  try {
    const { items } = req.body
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'items must be an array' })
    }
    const formattedItems = items
      .filter((item) => item.productId && item.quantity > 0)
      .map((item) => ({ product: item.productId, quantity: item.quantity }))

    const cart = await Cart.findOneAndUpdate(
      { user: req.userId },
      { items: formattedItems },
      { returnDocument: 'after', upsert: true }
    ).populate('items.product')

    res.json(cart.items.map((item) => ({ ...item.product.toObject(), quantity: item.quantity })))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router