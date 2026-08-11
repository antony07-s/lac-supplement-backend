const express = require('express')
const router = express.Router()
const Wishlist = require('../models/Wishlist')
const { protect } = require('../middleware/authMiddleware')

router.get('/', protect, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.userId }).populate('products')
    res.json(wishlist ? wishlist.products : [])
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/', protect, async (req, res) => {
  try {
    const { productIds } = req.body // expects ['id1', 'id2', ...]
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ message: 'productIds must be an array' })
    }

    const wishlist = await Wishlist.findOneAndUpdate(
      { user: req.userId },
      { products: productIds },
      { new: true, upsert: true }
    ).populate('products')

    res.json(wishlist.products)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router