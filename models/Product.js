const mongoose = require('mongoose')

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
}, { timestamps: true })

productSchema.index({ category: 1, createdAt: -1 })

module.exports = mongoose.model('Product', productSchema)
