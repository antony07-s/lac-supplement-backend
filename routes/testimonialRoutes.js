const express = require('express')
const router = express.Router()
const Testimonial = require('../models/Testimonial')

router.get('/', async (req, res) => {
  try {
    const testimonials = await Testimonial.find()
    res.json(testimonials)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const newTestimonial = new Testimonial(req.body)
    const saved = await newTestimonial.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/', async (req, res) => {
  try {
    await Testimonial.deleteMany({})
    res.json({ message: 'All testimonials deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router