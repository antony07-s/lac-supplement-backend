const express = require('express')
const router = express.Router()
const multer = require('multer')
const Product = require('../models/Product')
const { cloudinary, storage, videoStorage } = require('../config/cloudinary')
const { protect, adminOnly } = require('../middleware/authMiddleware')
const { canonicalCategory, categoryValues } = require('../config/categories')
const isValidId = (id) => require('mongoose').isValidObjectId(id)

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, callback) => {
    callback(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype))
  },
})
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => callback(null, /^video\/(mp4|webm|quicktime)$/.test(file.mimetype)),
})

const videoUrl = (value) => {
  const url = String(value || '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS video URLs are allowed')
    return parsed.href
  } catch {
    throw Object.assign(new Error('Invalid video URL'), { status: 400 })
  }
}

const requiredNumber = (value, field) => {
  if (value === '' || value === undefined || value === null) throw Object.assign(new Error(`${field} is required`), { status: 400 })
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400 })
  return number
}

const serializeProduct = (product) => ({
  ...product.toObject(),
  category: canonicalCategory(product.category),
})

const productPayload = (body) => {
  const hasVariants = Array.isArray(body.variants) && body.variants.length > 0
  if (!hasVariants) {
    const stock = requiredNumber(body.stock, 'Stock')
    if (!Number.isSafeInteger(stock)) throw Object.assign(new Error('Stock must be a whole number'), { status: 400 })
    requiredNumber(body.shippingWeightKg, 'Shipping weight')
    if (Number(body.shippingWeightKg) <= 0) throw Object.assign(new Error('Shipping weight must be greater than zero'), { status: 400 })
  }
  for (const variant of (hasVariants ? body.variants : [])) {
    const stock = requiredNumber(variant.stock, 'Variant stock')
    if (!Number.isSafeInteger(stock)) throw Object.assign(new Error('Variant stock must be a whole number'), { status: 400 })
    requiredNumber(variant.shippingWeightKg, 'Variant shipping weight')
    if (Number(variant.shippingWeightKg) <= 0) throw Object.assign(new Error('Variant shipping weight must be greater than zero'), { status: 400 })
  }
  return ({
  name: String(body.name || '').trim(),
  price: requiredNumber(body.price, 'Price'),
  originalPrice: body.originalPrice === '' || body.originalPrice === undefined ? requiredNumber(body.price, 'Price') : requiredNumber(body.originalPrice, 'Original price'),
  image: String(body.image || '').trim(),
  ...(Array.isArray(body.images) && {
    images: [...new Set(body.images.map((image) => String(image || '').trim()).filter(Boolean))].slice(0, 20),
  }),
  description: String(body.description || '').trim(),
  videoUrl: videoUrl(body.videoUrl),
  videoPublicId: String(body.videoPublicId || '').trim(),
  bestSeller: body.bestSeller === true,
  category: canonicalCategory(body.category),
  healthGoals: [...new Set((Array.isArray(body.healthGoals) ? body.healthGoals : [])
    .map((goal) => String(goal || '').trim())
    .filter(Boolean))].slice(0, 8),
  ...(body.shippingWeightKg !== undefined && { shippingWeightKg: requiredNumber(body.shippingWeightKg, 'Shipping weight') }),
  ...(body.stock !== undefined && { stock: Number(body.stock) }),
  ...(Array.isArray(body.variants) && {
    variants: body.variants.map((variant) => ({
      ...(variant._id && { _id: variant._id }),
      packSize: String(variant.packSize || '').trim(),
      price: requiredNumber(variant.price, 'Variant price'),
      originalPrice: variant.originalPrice === '' || variant.originalPrice === undefined ? requiredNumber(variant.price, 'Variant price') : requiredNumber(variant.originalPrice, 'Variant original price'),
      sku: String(variant.sku || '').trim(),
      stock: requiredNumber(variant.stock, 'Variant stock'),
      image: String(variant.image || '').trim(),
      ...(variant.shippingWeightKg !== undefined && { shippingWeightKg: requiredNumber(variant.shippingWeightKg, 'Variant shipping weight') }),
      isAvailable: variant.isAvailable !== false,
    })),
  }),
  })
}

// GET all products
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
    const query = {}
    if (req.query.category) query.category = { $in: categoryValues(req.query.category) }
    if (req.query.healthGoal) query.healthGoals = String(req.query.healthGoal).trim()
    if (req.query.bestSeller === 'true') query.bestSeller = true
    if (req.query.search) {
      const term = String(req.query.search).trim().slice(0, 100)
      if (term) query.$or = [{ name: { $regex: term, $options: 'i' } }, { description: { $regex: term, $options: 'i' } }]
    }
    const sortOptions = {
      catalog: { displayOrder: 1, createdAt: -1 },
      newest: { createdAt: -1 },
      'price-asc': { price: 1, _id: 1 },
      'price-desc': { price: -1, _id: 1 },
      name: { name: 1, _id: 1 },
    }
    const sort = sortOptions[String(req.query.sort || 'catalog')] || sortOptions.catalog
    const fields = '_id name price originalPrice image images displayOrder rating reviews bestSeller stock shippingWeightKg description videoUrl videoPublicId category healthGoals variants createdAt updatedAt __v'
    const [products, total] = await Promise.all([
      Product.find(query).select(fields).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
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
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' })
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
}, (err, req, res, next) => {
  res.status(400).json({ message: err.message || 'Upload failed' })
})

// Import one row per image; rows with the same product title become one product.
router.post('/bulk-import', protect, adminOnly, async (req, res, next) => {
  try {
    const incoming = req.body?.products
    if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 150) {
      return res.status(400).json({ message: 'Upload between 1 and 150 grouped products.' })
    }

    const normalizeName = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase()
    const names = incoming.map((product) => normalizeName(product?.name))
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      return res.status(400).json({ message: 'Each product title must be present and unique after grouping.' })
    }

    const existingNames = await Product.find({}).select('name').lean()
    const existingByName = new Map(existingNames.map((product) => [normalizeName(product.name), product.name]))
    const skipped = incoming
      .filter((product) => existingByName.has(normalizeName(product.name)))
      .map((product) => existingByName.get(normalizeName(product.name)))
    const toCreate = incoming.filter((product) => !existingByName.has(normalizeName(product.name)))

    const prepared = []
    const invalid = []
    for (const product of toCreate) {
      try {
        const imageUrls = [...new Set((Array.isArray(product.images) ? product.images : [])
          .map((image) => String(image || '').trim())
          .filter(Boolean))]
        if (!imageUrls.length || imageUrls.some((image) => {
          try { return new URL(image).protocol !== 'https:' } catch { return true }
        })) throw new Error('One or more valid HTTPS image URLs are required.')
        if (imageUrls.length > 20) throw new Error('A product cannot have more than 20 images.')
        if (!String(product.description || '').trim()) throw new Error('Description is required.')
        const payload = productPayload({ ...product, image: product.image || imageUrls[0], images: imageUrls })
        const document = new Product(payload)
        await document.validate()
        prepared.push(payload)
      } catch (error) {
        invalid.push({ name: product.name, message: error.message || 'Product data is invalid.' })
      }
    }

    if (req.query.preview === 'true') {
      return res.json({
        createCount: prepared.length,
        totalNew: toCreate.length,
        createNames: prepared.map((product) => product.name),
        skipped,
        invalid,
        message: invalid.length
          ? `${skipped.length} existing titles will be left unchanged; ${invalid.length} new products need data before import.`
          : `${prepared.length} new products will be added; ${skipped.length} existing titles will remain unchanged.`,
      })
    }
    if (invalid.length) return res.status(400).json({ message: 'Some new products need corrections before import.', invalid })

    const lastOrderedProduct = await Product.findOne({ displayOrder: { $type: 'number' } })
      .sort({ displayOrder: -1 }).select('displayOrder').lean()
    const nextOrder = Number(lastOrderedProduct?.displayOrder ?? 0) + 1
    const documents = prepared.map((payload, index) => new Product({ ...payload, displayOrder: nextOrder + index }))
    if (!documents.length) return res.json({ created: [], skipped, message: 'All imported titles already exist; no catalog records changed.' })
    const saved = await Product.insertMany(documents)
    res.status(201).json({
      created: saved.map((product) => ({ id: product._id, name: product.name })),
      skipped,
      message: `Imported ${saved.length} products; existing titles were left unchanged.`,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message })
    next(err)
  }
})

router.post('/upload-video', protect, adminOnly, uploadVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No video uploaded' })
  res.json({ videoUrl: req.file.path, videoPublicId: req.file.filename || req.file.public_id || '' })
}, (err, req, res, next) => {
  res.status(400).json({ message: err.message || 'Video upload failed' })
})

// PUT (update) an existing product
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' })
    const existingProduct = await Product.findById(req.params.id)
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    const payload = productPayload(req.body)
    const previousVideoPublicId = existingProduct.videoPublicId
    existingProduct.set(payload)
    const updatedProduct = await existingProduct.save()
    if (previousVideoPublicId && previousVideoPublicId !== updatedProduct.videoPublicId) {
      cloudinary.uploader.destroy(previousVideoPublicId, { resource_type: 'video', invalidate: true }).catch((error) => {
        console.error('Unable to remove replaced product video from Cloudinary:', error.message)
      })
    }
    res.json(serializeProduct(updatedProduct))
  } catch (err) {
    res.status(400).json({ message: 'Invalid product data' })
  }
})

// DELETE a single product
router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' })
    const deletedProduct = await Product.findByIdAndDelete(req.params.id)
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Product not found' })
    }
    if (deletedProduct.videoPublicId) {
      cloudinary.uploader.destroy(deletedProduct.videoPublicId, { resource_type: 'video', invalidate: true }).catch((error) => {
        console.error('Unable to remove deleted product video from Cloudinary:', error.message)
      })
    }
    res.json({ message: 'Product deleted', deletedProduct })
  } catch (err) {
    next(err)
  }
})

module.exports = router
