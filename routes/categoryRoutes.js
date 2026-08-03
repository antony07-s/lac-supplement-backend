const express = require('express')
const router = express.Router()
const Category = require('../models/Category')

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find()
    res.json(categories)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const newCategory = new Category(req.body)
    const saved = await newCategory.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/', async (req, res) => {
  try {
    await Category.deleteMany({})
    res.json({ message: 'All categories deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router