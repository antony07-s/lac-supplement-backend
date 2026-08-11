const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: 'Enter a valid name, email, and password of at least 8 characters' })
    }

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newUser = new User({ name, email, password: hashedPassword })
    await newUser.save()

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' })

    res.status(201).json({
      token,
      user: { id: newUser._id, name: newUser.name, email: newUser.email, isAdmin: newUser.isAdmin },
    })
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Email already registered' })
    res.status(500).json({ message: 'Unable to register account' })
  }
})

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    if (!email || !password) return res.status(400).json({ message: 'Invalid email or password' })

    const user = await User.findOne({ email }).select('+password')
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })

    res.json({
  token,
  user: { id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin },
})
  } catch (err) {
    res.status(500).json({ message: 'Unable to sign in' })
  }
})

module.exports = router
