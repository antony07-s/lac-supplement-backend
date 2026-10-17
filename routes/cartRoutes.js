const express = require('express')
const router = express.Router()
const Cart = require('../models/Cart')
const Product = require('../models/Product')
const mongoose = require('mongoose')
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
    res.status(500).json({ message: 'Unable to load your cart.' })
  }
})

router.put('/', protect, async (req, res) => {
  try {
    const { items } = req.body
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: 'items must be an array' })
    }
    const validItems = items.slice(0, 50).filter((item) => {
      const quantity = Number(item.quantity)
      return mongoose.isValidObjectId(item.productId) && (!item.variantId || mongoose.isValidObjectId(item.variantId)) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 100
    })
    const products = await Product.find({ _id: { $in: [...new Set(validItems.map((item) => String(item.productId)))] } }).select('variants stock')
    const productsById = new Map(products.map((product) => [String(product._id), product]))
    const formattedItems = []
    for (const item of validItems) {
      const quantity = Number(item.quantity)
      const product = productsById.get(String(item.productId))
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
    res.status(500).json({ message: 'Unable to save your cart.' })
  }
})

module.exports = router
