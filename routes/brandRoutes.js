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

router.put('/:id', async (req, res) => {
  try {
    const updated = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!updated) {
      return res.status(404).json({ message: 'Brand not found' })
    }
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Brand.findByIdAndDelete(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Brand not found' })
    }
    res.json({ message: 'Brand deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router