const mongoose = require('mongoose')

const variantSchema = new mongoose.Schema({
  packSize: { type: String, required: true, trim: true, maxlength: 100 },
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, min: 0 },
  sku: { type: String, trim: true, uppercase: true, maxlength: 100 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  image: { type: String, trim: true },
  shippingWeightKg: { type: Number, min: 0 },
  isAvailable: { type: Boolean, default: true },
}, { _id: true })

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160, index: true },
  price: { type: Number, required: true, min: 0 },
  originalPrice: { type: Number, required: true, min: 0 },
  image: { type: String, trim: true, default: '' },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  reviews: { type: Number, default: 0, min: 0 },
  stock: { type: Number, min: 0 },
  // Kilograms. Required for a shipping-enabled checkout; existing catalogue
  // records must be populated by an administrator before sale.
  shippingWeightKg: { type: Number, min: 0 },
  description: { type: String, trim: true, maxlength: 5000 },
  videoUrl: { type: String, trim: true, maxlength: 2048 },
  videoPublicId: { type: String, trim: true, maxlength: 500 },
  category: { type: String, required: true, trim: true, index: true },
  // Curated customer-facing wellness collections. A product may support more than one goal.
  healthGoals: { type: [{ type: String, trim: true, maxlength: 100 }], default: [], index: true },
  variants: { type: [variantSchema], default: [] },
}, { timestamps: true })

productSchema.index({ category: 1, createdAt: -1 })
productSchema.index({ healthGoals: 1, createdAt: -1 })

module.exports = mongoose.model('Product', productSchema)
