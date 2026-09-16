const jwt = require('jsonwebtoken')
const User = require('../models/User')

async function protect(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' })
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    const user = await User.findById(decoded.id).select('email').lean()
    if (!user) return res.status(401).json({ message: 'Not authorized, invalid token' })
    req.userId = String(user._id)
    req.userEmail = user.email
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, invalid token' })
  }
}

async function adminOnly(req, res, next) {
  try {
    const user = await User.findById(req.userId)
    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' })
    }
    next()
  } catch (err) {
    res.status(500).json({ message: 'Unable to verify admin access' })
  }
}

module.exports = { protect, adminOnly }
