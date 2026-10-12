const mongoose = require('mongoose')

const orderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [
        {
            product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
            variant: { type: mongoose.Schema.Types.ObjectId },
            name: { type: String, required: true },
            packSize: { type: String, trim: true },
            sku: { type: String, trim: true },
            image: { type: String, trim: true },
            price: { type: Number, required: true },
            weightKg: { type: Number, min: 0, default: 0 },
            quantity: { type: Number, required: true },
        },
    ],
    shippingAddress: {
        fullName: { type: String, required: true },
        phone: { type: String, required: true },
        addressLine1: { type: String, required: true },
        addressLine2: { type: String },
        city: { type: String, required: true },
        state: { type: String, required: true },
        postcode: { type: String, required: true },
        country: { type: String, enum: ['Malaysia', 'India'], default: 'Malaysia' },
    },
    totalAmount: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, min: 0, default: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    totalWeightKg: { type: Number, min: 0, default: 0 },
    shippingRegion: { type: String, enum: ['west-malaysia', 'east-malaysia', 'india'] },
    clientRequestId: { type: String, trim: true, maxlength: 100, unique: true, sparse: true },
    paypalOrderId: { type: String, trim: true, unique: true, sparse: true },
    paypalCreateRequestId: { type: String, trim: true, unique: true, sparse: true },
    paypalCaptureId: { type: String, trim: true, unique: true, sparse: true },
    razorpayOrderId: { type: String, trim: true, unique: true, sparse: true },
    razorpayCreateRequestId: { type: String, trim: true, unique: true, sparse: true },
    razorpayPaymentId: { type: String, trim: true, unique: true, sparse: true },
    paymentProvider: { type: String, enum: ['paypal', 'razorpay'] },
    // Set before a server-side capture/verification call. Cancellation and the
    // expiry worker must not release stock while a provider request is active.
    paymentProcessing: { type: Boolean, default: false, index: true },
    paymentProcessingSince: { type: Date, default: null },
    paymentIssue: { type: String, enum: ['late_capture', 'provider_mismatch', 'refund_reconciliation'], default: null },
    refundStatus: { type: String, enum: ['not-requested', 'processing', 'pending', 'failed', 'completed', 'reconciliation-required'], default: 'not-requested', index: true },
    refundRequestId: { type: String, trim: true, unique: true, sparse: true },
    refundId: { type: String, trim: true, unique: true, sparse: true },
    refundRequestedAt: { type: Date, default: null },
    refundCompletedAt: { type: Date, default: null },
    refundLastError: { type: String, trim: true, maxlength: 500, default: '' },
    stockReserved: { type: Boolean, default: true },
    status: { type: String, enum: ['pending', 'paid', 'cancelled', 'shipped', 'delivered', 'refunded'], default: 'pending' },
    statusNote: { type: String, trim: true, maxlength: 1000, default: '' },
    courierName: { type: String, trim: true, default: null },
    trackingNumber: { type: String, trim: true, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    fulfilmentNote: { type: String, trim: true, maxlength: 1000, default: '' },
    shipmentEmailStatus: { type: String, enum: ['not-sent', 'sent', 'failed'], default: 'not-sent' },
    shipmentEmailSentAt: { type: Date, default: null },
    shipmentEmailLastError: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true })


orderSchema.index({ user: 1, createdAt: -1 })
orderSchema.index({ status: 1, createdAt: 1 })
orderSchema.index({ createdAt: -1 })

module.exports = mongoose.model('Order', orderSchema)
