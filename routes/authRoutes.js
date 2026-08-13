const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const User = require('../models/User')

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const namePattern = /^(?=.{2,100}$)[\p{L}][\p{L}\p{M}' -]*$/u
const isStrongPassword = (password) => password.length >= 8
  && password.length <= 128
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password)

// REGISTER
router.post('/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    if (!namePattern.test(name)) {
      return res.status(400).json({ message: 'Enter a name between 2 and 100 characters using letters, spaces, hyphens, or apostrophes' })
    }
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' })
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({ message: 'Password must be 8–128 characters and include uppercase, lowercase, a number, and a symbol' })
    }

    const existingUser = await User.findOne({ email })
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

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
    if (!emailPattern.test(email) || !password || password.length > 128) return res.status(400).json({ message: 'Invalid email or password' })

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
