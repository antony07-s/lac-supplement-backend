const express = require('express')
const router = express.Router()
const Testimonial = require('../models/Testimonial')
const { protect, adminOnly } = require('../middleware/authMiddleware')

router.get('/', async (req, res) => {
  try {
    const testimonials = await Testimonial.find()
    res.json(testimonials)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const newTestimonial = new Testimonial(req.body)
    const saved = await newTestimonial.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const updated = await Testimonial.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!updated) {
      return res.status(404).json({ message: 'Testimonial not found' })
    }
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deleted = await Testimonial.findByIdAndDelete(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Testimonial not found' })
    }
    res.json({ message: 'Testimonial deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router