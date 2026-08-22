const express = require('express')
const router = express.Router()
const Wishlist = require('../models/Wishlist')
const { protect } = require('../middleware/authMiddleware')

router.get('/', protect, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.userId }).populate('products').populate('items.product')
    if (!wishlist) return res.json([])
    const items = wishlist.items.length ? wishlist.items : wishlist.products.map((product) => ({ product }))
    res.json(items.filter((item) => item.product).map((item) => {
      const product = item.product.toObject ? item.product.toObject() : item.product
      const variant = item.variant ? product.variants.find((entry) => String(entry._id) === String(item.variant)) : null
      return { ...product, variantId: variant?._id, packSize: variant?.packSize, price: variant?.price ?? product.price, image: variant?.image || product.image }
    }))
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
    const formattedItems = items.slice(0, 100).filter((item) => item.productId).map((item) => ({ product: item.productId, ...(item.variantId && { variant: item.variantId }) }))

    const wishlist = await Wishlist.findOneAndUpdate(
      { user: req.userId },
      { items: formattedItems, products: formattedItems.map((item) => item.product) },
      { returnDocument: 'after', upsert: true }
    ).populate('items.product')

    res.json(wishlist.items)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
