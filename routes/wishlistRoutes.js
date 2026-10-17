const express = require('express')
const router = express.Router()
const Wishlist = require('../models/Wishlist')
const mongoose = require('mongoose')
const Product = require('../models/Product')
const { protect } = require('../middleware/authMiddleware')

function serializeWishlistItem(item) {
  const product = item.product?.toObject ? item.product.toObject() : item.product
  if (!product) return null
  const variant = item.variant ? product.variants.find((entry) => String(entry._id) === String(item.variant)) : null
  return { ...product, variantId: variant?._id, packSize: variant?.packSize, price: variant?.price ?? product.price, image: variant?.image || product.image }
}

router.get('/', protect, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ user: req.userId }).populate('products').populate('items.product')
    if (!wishlist) return res.json([])
    const items = wishlist.items.length ? wishlist.items : wishlist.products.map((product) => ({ product }))
    res.json(items.map(serializeWishlistItem).filter(Boolean))
  } catch (err) {
    res.status(500).json({ message: 'Unable to load your wishlist.' })
  }
})

router.put('/', protect, async (req, res) => {
  try {
    const { items } = req.body
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'items must be an array' })
    }
    const formattedItems = []
    const validItems = items.slice(0, 100).filter((item) => mongoose.isValidObjectId(item.productId) && (!item.variantId || mongoose.isValidObjectId(item.variantId)))
    const products = await Product.find({ _id: { $in: [...new Set(validItems.map((item) => String(item.productId)))] } }).select('variants')
    const productsById = new Map(products.map((product) => [String(product._id), product]))
    for (const item of validItems) {
      const product = productsById.get(String(item.productId))
      if (!product || (item.variantId && !product.variants.id(item.variantId))) continue
      formattedItems.push({ product: product._id, ...(item.variantId && { variant: item.variantId }) })
    }

    const wishlist = await Wishlist.findOneAndUpdate(
      { user: req.userId },
      { items: formattedItems, products: formattedItems.map((item) => item.product) },
      { returnDocument: 'after', upsert: true }
    ).populate('items.product')

    res.json(wishlist.items.map(serializeWishlistItem).filter(Boolean))
  } catch (err) {
    res.status(500).json({ message: 'Unable to save your wishlist.' })
  }
})

module.exports = router
