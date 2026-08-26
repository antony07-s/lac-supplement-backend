const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const User = require('../models/User')
const { sendNotification } = require('../config/mailer')

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

// Request a reset link. The response is deliberately the same for all email addresses.
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!emailPattern.test(email)) return res.status(400).json({ message: 'Enter a valid email address' })
  try {
    const user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpires')
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex')
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000)
      await user.save({ validateBeforeSave: false })
      const clientUrl = (process.env.CLIENT_URL || process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '')
      const resetUrl = `${clientUrl}/reset-password/${rawToken}`
      try {
        await sendNotification({
          to: user.email,
          subject: 'Reset your AYUSYDAH password',
          text: `We received a request to reset your password. Open this link within one hour:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        })
      } catch (error) {
        user.resetPasswordToken = undefined
        user.resetPasswordExpires = undefined
        await user.save({ validateBeforeSave: false })
        console.error('Password reset email failed:', error.message)
        return res.status(503).json({ message: 'Password reset email is temporarily unavailable. Please try again later.' })
      }
    }
    res.json({ message: 'If an account exists for that email, a reset link has been sent.' })
  } catch (err) {
    res.status(500).json({ message: 'Unable to request a password reset' })
  }
})

router.post('/reset-password/:token', async (req, res) => {
  const password = String(req.body.password || '')
  if (!isStrongPassword(password)) return res.status(400).json({ message: 'Password must be 8–128 characters and include uppercase, lowercase, a number, and a symbol' })
  const token = crypto.createHash('sha256').update(String(req.params.token || '')).digest('hex')
  try {
    const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: new Date() } }).select('+password +resetPasswordToken +resetPasswordExpires')
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired. Please request a new one.' })
    user.password = password
    user.resetPasswordToken = undefined
    user.resetPasswordExpires = undefined
    await user.save()
    res.json({ message: 'Password reset successfully. You can now sign in.' })
  } catch (err) {
    res.status(500).json({ message: 'Unable to reset password' })
  }
})
  } catch (err) {
    res.status(500).json({ message: 'Unable to sign in' })
  }
})

module.exports = router
