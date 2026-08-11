const express = require('express')
const router = express.Router()
const multer = require('multer')
const Product = require('../models/Product')
const { storage } = require('../config/cloudinary')
const { protect, adminOnly } = require('../middleware/authMiddleware')
const { canonicalCategory, categoryValues } = require('../config/categories')

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, callback) => {
    callback(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
  },
})

const serializeProduct = (product) => ({
  ...product.toObject(),
  category: canonicalCategory(product.category),
})

const productPayload = (body) => ({
  name: String(body.name || '').trim(),
  price: Number(body.price),
  originalPrice: body.originalPrice === '' || body.originalPrice === undefined ? Number(body.price) : Number(body.originalPrice),
  image: String(body.image || '').trim(),
  description: String(body.description || '').trim(),
  category: canonicalCategory(body.category),
  ...(body.stock !== undefined && { stock: Number(body.stock) }),
})

// GET all products
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
    const query = {}
    if (req.query.category) query.category = { $in: categoryValues(req.query.category) }
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 100)
      if (term) query.$or = [{ name: { $regex: term, $options: 'i' } }, { description: { $regex: term, $options: 'i' } }]
    }
    const [products, total] = await Promise.all([
      Product.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Product.countDocuments(query),
    ])
    res.json({ products: products.map((product) => ({ ...product, category: canonicalCategory(product.category) })), page, limit, total })
  } catch (err) {
    next(err)
  }
})

// GET a single product by ID
router.get('/:id', async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(serializeProduct(product))
  } catch (err) {
    next(err)
  }
})

// POST a new product
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const newProduct = new Product(productPayload(req.body))
    const savedProduct = await newProduct.save()
    res.status(201).json(savedProduct)
  } catch (err) {
    res.status(400).json({ message: 'Invalid product data' })
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
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, productPayload(req.body), { new: true, runValidators: true })
    if (!updatedProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json(serializeProduct(updatedProduct))
  } catch (err) {
    res.status(400).json({ message: 'Invalid product data' })
  }
})

// DELETE a single product
router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id)
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    res.json({ message: 'Product deleted', deletedProduct })
  } catch (err) {
    next(err)
  }
})

module.exports = router
