const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const https = require('https')
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
const adminEmails = new Set(['antony.s8637@gmail.com', 'lsmu@hotmail.com'])
const createToken = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })
const userResponse = (user) => ({ id: user._id, name: user.name, email: user.email, isAdmin: user.isAdmin })
let googleKeys = null
let googleKeysExpiresAt = 0

function getGoogleKeys() {
  if (googleKeys && Date.now() < googleKeysExpiresAt) return Promise.resolve(googleKeys)
  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/oauth2/v3/certs', (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Unable to retrieve Google signing keys')
          googleKeys = JSON.parse(body).keys || []
          googleKeysExpiresAt = Date.now() + 60 * 60 * 1000
          resolve(googleKeys)
        } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

async function verifyGoogleCredential(credential) {
  const [encodedHeader, encodedPayload, encodedSignature] = credential.split('.')
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Invalid Google credential')
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'))
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Invalid Google credential')
  const key = (await getGoogleKeys()).find((candidate) => candidate.kid === header.kid)
  if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(encodedSignature, 'base64url'))) throw new Error('Invalid Google credential')
  const now = Math.floor(Date.now() / 1000)
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID || payload.exp <= now || payload.iat > now + 60 || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Invalid Google credential')
  return payload
}

async function applyAdminRole(user) {
  if (adminEmails.has(user.email) && !user.isAdmin) {
    user.isAdmin = true
    await user.save({ validateBeforeSave: false })
  }
  return user
}

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

    const newUser = new User({ name, email, password: hashedPassword, isAdmin: adminEmails.has(email) })
    await newUser.save()

    const token = createToken(newUser)

    res.status(201).json({
      token,
      user: userResponse(newUser),
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
    if (!user || !user.password) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' })
    }

    await applyAdminRole(user)
    const token = createToken(user)

    res.json({
      token,
      user: userResponse(user),
    })
  } catch (err) {
    res.status(500).json({ message: 'Unable to sign in' })
  }
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

// Google issues the identity token; it is verified server-side before any account is created or linked.
router.post('/google', async (req, res) => {
  const credential = String(req.body.credential || '')
  if (!credential) return res.status(400).json({ message: 'Google sign-in could not be completed. Please try again.' })
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ message: 'Google sign-in is not configured yet.' })
  try {
    const payload = await verifyGoogleCredential(credential)
    const email = String(payload?.email || '').trim().toLowerCase()
    const googleId = String(payload?.sub || '')
    const name = String(payload?.name || email.split('@')[0]).trim().slice(0, 100)
    if (!payload?.email_verified || !emailPattern.test(email) || !googleId) return res.status(401).json({ message: 'Your Google account email could not be verified.' })

    const googleUser = await User.findOne({ googleId }).select('+googleId')
    let user = await User.findOne({ email }).select('+googleId')
    if (googleUser && user && String(googleUser._id) !== String(user._id)) return res.status(409).json({ message: 'This Google account is already linked to another user.' })
    user = googleUser || user
    if (!user) user = new User({ name: name || 'Google user', email, googleId, isAdmin: adminEmails.has(email) })
    else if (!user.googleId) user.googleId = googleId
    await applyAdminRole(user)
    await user.save()

    res.json({ token: createToken(user), user: userResponse(user) })
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: 'This Google account is already linked to another user.' })
    return res.status(401).json({ message: 'Google sign-in failed. Please try again.' })
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

module.exports = router