require('dotenv').config()

const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const compression = require('compression')
const rateLimit = require('express-rate-limit')

const productRoutes = require('./routes/productRoutes')
const categoryRoutes = require('./routes/categoryRoutes')
const healthGoalRoutes = require('./routes/healthGoalRoutes')
const brandRoutes = require('./routes/brandRoutes')
const testimonialRoutes = require('./routes/testimonialRoutes')
const authRoutes = require('./routes/authRoutes')
const orderRoutes = require('./routes/orderRoutes')
const contactRoutes = require('./routes/contact')
const newsletterRoutes = require('./routes/newsletter')

const app = express()

const allowedOrigins = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,https://lac-supplement-store.vercel.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (!process.env.MONGO_URI || !process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('MONGO_URI and a JWT_SECRET of at least 32 characters must be configured')
}

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Origin not allowed by CORS'))
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}))
app.use(compression())
app.use(express.json({ limit: '100kb' }))
app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// General rate limit: applies to all API routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: { message: 'Too many requests, please try again later.' },
})
app.use('/api', generalLimiter)

// Stricter limit for auth routes (prevents brute-force login attempts)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many login attempts, please try again later.' },
})
app.use('/api/auth', authLimiter)

app.use('/api/categories', categoryRoutes)
app.use('/api/health-goals', healthGoalRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/testimonials', testimonialRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/contact', contactRoutes)
app.use('/api/newsletter', newsletterRoutes)

app.get('/', (req, res) => {
  res.json({ service: 'ayusydah-api', status: 'ok' })
})

app.get('/health', (req, res) => {
  const ready = mongoose.connection.readyState === 1
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' })
})

mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20,
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
  serverSelectionTimeoutMS: 10000,
})
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err))

const PORT = process.env.PORT || 5000
app.use('/api/products', productRoutes)

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ message: 'Invalid JSON body' })
  if (err.name === 'MulterError') return res.status(400).json({ message: 'Invalid upload' })
  console.error(err)
  return res.status(500).json({ message: 'Internal server error' })
})

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

const shutdown = () => server.close(() => mongoose.connection.close(false).finally(() => process.exit(0)))
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
