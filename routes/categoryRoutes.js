const express = require('express')
const router = express.Router()
const Category = require('../models/Category')
const { protect, adminOnly } = require('../middleware/authMiddleware')
const { canonicalCategory } = require('../config/categories')

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().lean()
    const seen = new Set()
    res.json(categories.filter((category) => {
      const name = canonicalCategory(category.name)
      if (seen.has(name)) return false
      seen.add(name)
      category.name = name
      return true
    }))
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const newCategory = new Category(req.body)
    const saved = await newCategory.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const updated = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!updated) {
      return res.status(404).json({ message: 'Category not found' })
    }
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await Category.findByIdAndDelete(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Category not found' })
    }
    res.json({ message: 'Category deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router
