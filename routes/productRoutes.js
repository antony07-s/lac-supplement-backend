const express = require('express')
const router = express.Router()
const multer = require('multer')
const Product = require('../models/Product')
const { storage } = require('../config/cloudinary')
const { protect, adminOnly } = require('../middleware/authMiddleware')

const upload = multer({ storage })

// GET all products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find()
    res.json(products)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET a single product by ID
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(product)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST a new product
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const newProduct = new Product(req.body)
    const savedProduct = await newProduct.save()
    res.status(201).json(savedProduct)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

// POST an image upload (returns the Cloudinary URL)
router.post('/upload', protect, adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' })
  }
  res.json({ imageUrl: req.file.path })
}, (err, req, res, next) => {
  res.status(400).json({ message: err.message || 'Upload failed' })
})

// POST multiple image uploads (returns an array of Cloudinary URLs)
router.post('/upload-multiple', protect, adminOnly, upload.array('images', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' })
  }
  const imageUrls = req.files.map((file) => file.path)
  res.json({ imageUrls })
})

// PUT (update) an existing product
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
    if (!updatedProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(updatedProduct)
  } catch (err) {
    res.status(400).json({ message: err.message })
  }
})

// DELETE a single product
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id)
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json({ message: 'Product deleted', deletedProduct })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router