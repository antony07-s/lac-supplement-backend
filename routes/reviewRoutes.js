const express = require('express')
const mongoose = require('mongoose')
const router = express.Router()
const Review = require('../models/Review')
const Order = require('../models/Order')
const Product = require('../models/Product')
const { protect, adminOnly } = require('../middleware/authMiddleware')

async function refreshProductRating(productId) {
  const [summary] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), status: 'approved' } },
    { $group: { _id: null, rating: { $avg: '$rating' }, reviews: { $sum: 1 } } },
  ])
  await Product.findByIdAndUpdate(productId, {
    rating: summary ? Math.round(summary.rating * 10) / 10 : 0,
    reviews: summary?.reviews || 0,
  })
}

router.get('/product/:productId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID' })
  const reviews = await Review.find({ product: req.params.productId, status: 'approved' })
    .populate('user', 'name')
    .sort({ createdAt: -1 })
    .lean()
  res.json(reviews)
})

router.get('/eligibility/:productId', protect, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID' })
  const existing = await Review.findOne({ product: req.params.productId, user: req.userId }).select('status').lean()
  const order = await Order.findOne({ user: req.userId, status: 'delivered', 'items.product': req.params.productId }).select('_id').lean()
  res.json({ eligible: Boolean(order) && !existing, reviewStatus: existing?.status || null })
})

router.post('/', protect, async (req, res) => {
  try {
    const { productId, rating, title, comment } = req.body
    if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ message: 'Invalid product ID' })
    const order = await Order.findOne({ user: req.userId, status: 'delivered', 'items.product': productId }).select('_id').lean()
    if (!order) return res.status(403).json({ message: 'Reviews are available after a verified purchase is delivered.' })
    const review = await Review.create({ product: productId, user: req.userId, order: order._id, rating, title, comment })
    res.status(201).json(review)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already reviewed this product.' })
    res.status(400).json({ message: err.message || 'Unable to submit review' })
  }
})

router.get('/', protect, adminOnly, async (_req, res) => {
  const reviews = await Review.find().populate('product', 'name').populate('user', 'name email').sort({ createdAt: -1 })
  res.json(reviews)
})

router.put('/:id/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Invalid review status' })
  const review = await Review.findByIdAndUpdate(req.params.id, { status }, { new: true })
  if (!review) return res.status(404).json({ message: 'Review not found' })
  await refreshProductRating(review.product)
  res.json(review)
})

module.exports = router
