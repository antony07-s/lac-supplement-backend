const express = require('express')
const router = express.Router()
const HealthGoal = require('../models/HealthGoal')

router.get('/', async (req, res) => {
  try {
    const goals = await HealthGoal.find()
    res.json(goals)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', async (req, res) => {
  try {
    const newGoal = new HealthGoal(req.body)
    const saved = await newGoal.save()
    res.status(201).json(saved)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

router.delete('/', async (req, res) => {
  try {
    await HealthGoal.deleteMany({})
    res.json({ message: 'All health goals deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router