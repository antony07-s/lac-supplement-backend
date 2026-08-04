require('dotenv').config()

const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const productRoutes = require('./routes/productRoutes')
const categoryRoutes = require('./routes/categoryRoutes')
const healthGoalRoutes = require('./routes/healthGoalRoutes')
const brandRoutes = require('./routes/brandRoutes')
const testimonialRoutes = require('./routes/testimonialRoutes')
const authRoutes = require('./routes/authRoutes')
const orderRoutes = require('./routes/orderRoutes')

const app = express()

// app.use(cors())
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://lac-supplement-store.vercel.app'
  ]
}))
app.use(express.json())
app.use('/api/categories', categoryRoutes)
app.use('/api/health-goals', healthGoalRoutes)
app.use('/api/brands', brandRoutes)
app.use('/api/testimonials', testimonialRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/orders', orderRoutes)

app.get('/', (req, res) => {
  res.send('Ayusydah backend is running')
})

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err))

const PORT = process.env.PORT || 5000
app.use('/api/products', productRoutes)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})