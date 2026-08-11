const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  message: { type: String, required: true, trim: true, maxlength: 5000 },
  fingerprint: { type: String, required: true, index: true },
  read: { type: Boolean, default: false },
}, { timestamps: true })

messageSchema.index({ fingerprint: 1, createdAt: -1 })

module.exports = mongoose.model('Message', messageSchema)
