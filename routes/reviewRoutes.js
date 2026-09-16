const express = require('express')
const mongoose = require('mongoose')
const router = express.Router()
const Review = require('../models/Review')
const Order = require('../models/Order')
const Product = require('../models/Product')
const User = require('../models/User')
const { protect, adminOnly } = require('../middleware/authMiddleware')

const validSorts = { recent: { createdAt: -1 }, highest: { rating: -1, createdAt: -1 }, lowest: { rating: 1, createdAt: -1 } }
const reviewFields = 'rating title comment status createdAt updatedAt'
const isValidId = (id) => mongoose.isValidObjectId(id)
const pageOptions = (query) => ({ page: Math.max(1, Number.parseInt(query.page, 10) || 1), limit: Math.min(20, Math.max(1, Number.parseInt(query.limit, 10) || 10)) })

async function refreshProductRating(productId) {
  const [summary] = await Review.aggregate([{ $match: { product: new mongoose.Types.ObjectId(productId), status: 'approved' } }, { $group: { _id: null, rating: { $avg: '$rating' }, reviews: { $sum: 1 } } }])
  await Product.findByIdAndUpdate(productId, { rating: summary ? Math.round(summary.rating * 10) / 10 : 0, reviews: summary?.reviews || 0 })
}

router.get('/product/:productId', async (req, res, next) => {
  if (!isValidId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID' })
  try {
    const { page, limit } = pageOptions(req.query)
    const rating = Number(req.query.rating)
    const query = { product: req.params.productId, status: 'approved', ...(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? { rating } : {}) }
    const [reviews, total, breakdown] = await Promise.all([
      Review.find(query).populate('user', 'name').sort(validSorts[req.query.sort] || validSorts.recent).skip((page - 1) * limit).limit(limit).lean(),
      Review.countDocuments(query),
      Review.aggregate([{ $match: { product: new mongoose.Types.ObjectId(req.params.productId), status: 'approved' } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
    ])
    const counts = Object.fromEntries(breakdown.map(({ _id, count }) => [_id, count]))
    res.json({ reviews, page, limit, total, hasMore: page * limit < total, breakdown: [5, 4, 3, 2, 1].map((star) => ({ star, count: counts[star] || 0 })) })
  } catch (err) { next(err) }
})

router.get('/eligibility/:productId', protect, async (req, res, next) => {
  if (!isValidId(req.params.productId)) return res.status(400).json({ message: 'Invalid product ID' })
  try {
    const existing = await Review.findOne({ product: req.params.productId, user: req.userId }).select(reviewFields).lean()
    const order = await Order.findOne({ user: req.userId, status: 'delivered', 'items.product': req.params.productId }).select('_id').lean()
    res.json({ eligible: Boolean(order) && !existing, purchased: Boolean(order), reviewStatus: existing?.status || null, review: existing || null })
  } catch (err) { next(err) }
})

router.post('/', protect, async (req, res, next) => {
  try {
    const productId = String(req.body.productId || '')
    if (!isValidId(productId)) return res.status(400).json({ message: 'Invalid product ID' })
    const order = await Order.findOne({ user: req.userId, status: 'delivered', 'items.product': productId }).select('_id').lean()
    if (!order) return res.status(403).json({ message: 'Reviews are available after a verified purchase is delivered.' })
    const review = await Review.create({ product: productId, user: req.userId, order: order._id, rating: req.body.rating, title: req.body.title, comment: req.body.comment })
    res.status(201).json(review)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already reviewed this product.' })
    next(err)
  }
})

router.put('/mine/:id', protect, async (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid review ID' })
  try {
    const review = await Review.findOne({ _id: req.params.id, user: req.userId })
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    review.rating = req.body.rating; review.title = req.body.title; review.comment = req.body.comment; review.status = 'pending'
    await review.save(); await refreshProductRating(review.product)
    res.json(review)
  } catch (err) { next(err) }
})

router.delete('/mine/:id', protect, async (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid review ID' })
  try {
    const review = await Review.findOneAndDelete({ _id: req.params.id, user: req.userId })
    if (!review) return res.status(404).json({ message: 'Review not found.' })
    await refreshProductRating(review.product)
    res.json({ message: 'Your review has been deleted.' })
  } catch (err) { next(err) }
})

router.get('/', protect, adminOnly, async (req, res, next) => {
  try {
    const { page, limit } = pageOptions(req.query); const query = {}
    if (['pending', 'approved', 'rejected'].includes(req.query.status)) query.status = req.query.status
    const rating = Number(req.query.rating)
    if (Number.isInteger(rating) && rating >= 1 && rating <= 5) query.rating = rating
    const search = String(req.query.search || '').trim().slice(0, 100)
    if (search) {
      const [products, users] = await Promise.all([
        Product.find({ name: { $regex: search, $options: 'i' } }).select('_id').lean(),
        User.find({ $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }).select('_id').lean(),
      ])
      query.$or = [{ title: { $regex: search, $options: 'i' } }, { comment: { $regex: search, $options: 'i' } }, { product: { $in: products.map((product) => product._id) } }, { user: { $in: users.map((user) => user._id) } }]
    }
    const [reviews, total] = await Promise.all([Review.find(query).populate('product', 'name').populate('user', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Review.countDocuments(query)])
    res.json({ reviews, page, limit, total, hasMore: page * limit < total })
  } catch (err) { next(err) }
})

router.put('/:id/status', protect, adminOnly, async (req, res, next) => {
  if (!['pending', 'approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid review status' })
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid review ID' })
  try {
    const review = await Review.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })
    if (!review) return res.status(404).json({ message: 'Review not found' })
    await refreshProductRating(review.product); res.json(review)
  } catch (err) { next(err) }
})

router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid review ID' })
  try {
    const review = await Review.findByIdAndDelete(req.params.id)
    if (!review) return res.status(404).json({ message: 'Review not found' })
    await refreshProductRating(review.product); res.json({ message: 'Review deleted' })
  } catch (err) { next(err) }
})

module.exports = router
