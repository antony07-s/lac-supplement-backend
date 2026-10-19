const jwt = require('jsonwebtoken')
const User = require('../models/User')

const sessionCookieName = 'ayusydah_session'
const adminEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
const adminAllowlistConfigured = adminEmails.size > 0
const trustedOrigins = new Set([
  ...(process.env.CLIENT_ORIGINS || '').split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean),
  'https://ayusydah.com',
  'https://www.ayusydah.com',
  'https://lac-supplement-store.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
])

function readSessionCookie(req) {
  const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`))
  if (!cookie) return ''
  try { return decodeURIComponent(cookie.slice(sessionCookieName.length + 1)) } catch { return '' }
}

async function protect(req, res, next) {
  // Session scoped data must never be reused by a browser or intermediary cache.
  res.set('Cache-Control', 'private, no-store')
  const authHeader = req.headers.authorization

  const hasBearerToken = Boolean(authHeader?.startsWith('Bearer '))
  const token = hasBearerToken ? authHeader.split(' ')[1] : readSessionCookie(req)
  if (!token) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' })

  if (!hasBearerToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = String(req.get('Origin') || '').replace(/\/$/, '')
    if (!origin || !trustedOrigins.has(origin)) return res.status(403).json({ message: 'Request origin is not allowed.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    const user = await User.findById(decoded.id).select('email').lean()
    if (!user) return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' })
    req.userId = String(user._id)
    req.userEmail = user.email
    next()
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' })
  }
}

async function adminOnly(req, res, next) {
  try {
    const user = await User.findById(req.userId)
    if (!isAdminUser(user)) {
      return res.status(403).json({ message: 'Admin access required' })
    }
    next()
  } catch (err) {
    res.status(500).json({ message: 'Unable to verify admin access' })
  }
}

function isAdminUser(user) {
  const allowlisted = !adminAllowlistConfigured || adminEmails.has(String(user?.email || '').trim().toLowerCase())
  return Boolean(user?.isAdmin && allowlisted)
}

module.exports = { protect, adminOnly, isAdminUser }
