const mongoose = require('mongoose')

const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, trim: true, maxlength: 120, default: '' },
  comment: { type: String, trim: true, required: true, minlength: 5, maxlength: 2000 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
}, { timestamps: true })

// A customer may publish one review per product. This keeps product ratings meaningful.
reviewSchema.index({ product: 1, user: 1 }, { unique: true })

module.exports = mongoose.model('Review', reviewSchema)
