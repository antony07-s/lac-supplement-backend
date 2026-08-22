const mongoose = require('mongoose')

const variantSchema = new mongoose.Schema({
  packSize: { type: String, required: true, trim: true, maxlength: 100 },
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, min: 0 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 100 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  image: { type: String, trim: true },
  isAvailable: { type: Boolean, default: true },
}, { _id: true })

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160, index: true },
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, required: true, min: 0 },
  image: { type: String, required: true, trim: true },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviews: { type: Number, default: 0, min: 0 },
  stock: { type: Number, min: 0 },
  description: { type: String, trim: true, maxlength: 5000 },
  category: { type: String, required: true, trim: true, index: true },
  variants: { type: [variantSchema], default: [] },
}, { timestamps: true })

productSchema.index({ category: 1, createdAt: -1 })

module.exports = mongoose.model('Product', productSchema)
