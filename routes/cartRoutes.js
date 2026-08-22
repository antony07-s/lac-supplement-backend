const express = require('express')
const router = express.Router()
const Cart = require('../models/Cart')
const Product = require('../models/Product')
const { protect } = require('../middleware/authMiddleware')

router.get('/', protect, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.userId }).populate('items.product')
    res.json(cart ? cart.items.filter((item) => item.product).map((item) => {
      const product = item.product.toObject()
      const variant = item.variant ? product.variants.find((entry) => String(entry._id) === String(item.variant)) : null
      const sellable = variant || product
      return { ...product, variantId: variant?._id, packSize: variant?.packSize, sku: variant?.sku, image: variant?.image || product.image, price: sellable.price, originalPrice: sellable.originalPrice, stock: sellable.stock, isAvailable: variant ? variant.isAvailable : true, quantity: item.quantity }
    }) : [])
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
    const formattedItems = []
    for (const item of items.slice(0, 50)) {
      const quantity = Number(item.quantity)
      if (!item.productId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) continue
      const product = await Product.findById(item.productId).select('variants stock')
      if (!product) continue
      const variant = item.variantId ? product.variants.id(item.variantId) : null
      if (item.variantId && (!variant || !variant.isAvailable || variant.stock < quantity)) continue
      if (!variant && product.stock !== undefined && product.stock < quantity) continue
      formattedItems.push({ product: product._id, ...(variant && { variant: variant._id }), quantity })
    }

    const cart = await Cart.findOneAndUpdate(
      { user: req.userId },
      { items: formattedItems },
      { returnDocument: 'after', upsert: true }
    ).populate('items.product')

    res.json(cart.items.filter((item) => item.product).map((item) => {
      const product = item.product.toObject()
      const variant = item.variant ? product.variants.find((entry) => String(entry._id) === String(item.variant)) : null
      const sellable = variant || product
      return { ...product, variantId: variant?._id, packSize: variant?.packSize, sku: variant?.sku, image: variant?.image || product.image, price: sellable.price, originalPrice: sellable.originalPrice, stock: sellable.stock, isAvailable: variant ? variant.isAvailable : true, quantity: item.quantity }
    }))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
