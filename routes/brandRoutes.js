const express = require('express')
const router = express.Router()
const Brand = require('../models/Brand')

router.get('/', async (req, res) => {
  try {
    const brands = await Brand.find()
    res.json(brands)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const newBrand = new Brand(req.body)
    const saved = await newBrand.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/', async (req, res) => {
  try {
    await Brand.deleteMany({})
    res.json({ message: 'All brands deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router