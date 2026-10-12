const mongoose = require('mongoose')

// Provider webhook delivery is at-least-once. This receipt makes processing
// idempotent while retaining failed events for the provider's retry/reconcile.
const paymentEventSchema = new mongoose.Schema({
  provider: { type: String, enum: ['paypal', 'razorpay'], required: true },
  eventId: { type: String, required: true, trim: true },
  eventType: { type: String, required: true, trim: true },
  status: { type: String, enum: ['processing', 'processed', 'failed'], default: 'processing', index: true },
  attempts: { type: Number, default: 1, min: 1 },
  lastError: { type: String, trim: true, maxlength: 500, default: '' },
  processedAt: { type: Date, default: null },
}, { timestamps: true })

paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true })

module.exports = mongoose.model('PaymentEvent', paymentEventSchema)
