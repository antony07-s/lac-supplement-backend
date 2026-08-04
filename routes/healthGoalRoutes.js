const express = require('express')
const router = express.Router()
const HealthGoal = require('../models/HealthGoal')
const { protect } = require('../middleware/authMiddleware')

router.get('/', async (req, res) => {
  try {
    const goals = await HealthGoal.find()
    res.json(goals)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', protect, async (req, res) => {
  try {
    const newGoal = new HealthGoal(req.body)
    const saved = await newGoal.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.put('/:id', protect, async (req, res) => {
  try {
    const updated = await HealthGoal.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!updated) {
      return res.status(404).json({ message: 'Health goal not found' })
    }
    res.json(updated)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/:id', protect, async (req, res) => {
  try {
    const deleted = await HealthGoal.findByIdAndDelete(req.params.id)
    if (!deleted) {
      return res.status(404).json({ message: 'Health goal not found' })
    }
    res.json({ message: 'Health goal deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router