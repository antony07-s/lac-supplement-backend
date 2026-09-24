const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const { randomUUID } = require('crypto')
const rateLimit = require('express-rate-limit')
const Order = require('../models/Order')
const { protect } = require('../middleware/authMiddleware')
const { moneyToSen } = require('../utils/checkout')
const { CURRENCY, isRazorpayEnabled, getRazorpay, verifyPaymentSignature, settleRazorpayPayment } = require('../utils/razorpay')

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many payment requests. Please wait a moment and try again.' },
})

// Lets the checkout page decide whether to show the Razorpay button.
// Registered BEFORE orderRoutes in server.js so "/:id" doesn't swallow it.
router.get('/payment-options', protect, (req, res) => {
  res.json({ razorpay: isRazorpayEnabled() })
})

// CREATE a Razorpay order for an existing pending order.
router.post('/:id/razorpay-order', protect, paymentLimiter, async (req, res) => {
  try {
    if (!isRazorpayEnabled()) return res.status(503).json({ message: 'Razorpay payment is not available right now.' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID' })

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== req.userId) return res.status(403).json({ message: 'Not authorized to pay for this order' })
    if (order.status !== 'pending') return res.status(409).json({ message: `This order is already ${order.status} and cannot be paid again.` })
    if (order.paypalOrderId || (order.paymentProvider && order.paymentProvider !== 'razorpay')) {
      return res.status(409).json({ message: 'A different payment method has already been started for this order.' })
    }

    const amount = moneyToSen(order.totalAmount) // smallest unit (sen), never trusted from the browser
    const reply = (razorpayOrderId) => ({ orderId: razorpayOrderId, amount, currency: CURRENCY, keyId: process.env.RAZORPAY_KEY_ID })

    if (order.razorpayOrderId) return res.json(reply(order.razorpayOrderId))

    // Claim provider-order creation before making the external request. This
    // means two tabs cannot create two chargeable orders for one checkout.
    const createRequestId = randomUUID()
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: 'pending',
        razorpayOrderId: { $exists: false },
        razorpayCreateRequestId: { $exists: false },
        paymentProvider: { $in: [null, 'razorpay'] },
      },
      { $set: { razorpayCreateRequestId: createRequestId, paymentProvider: 'razorpay' } },
      { new: true },
    )
    if (!claimed) {
      const current = await Order.findById(order._id)
      if (current?.status === 'pending' && current.razorpayOrderId) return res.json(reply(current.razorpayOrderId))
      if (current?.status === 'pending' && current.razorpayCreateRequestId) return res.status(409).json({ message: 'Payment setup is still being confirmed. Please retry in a moment.' })
      return res.status(409).json({ message: 'This order can no longer be paid' })
    }

    let rzpOrder
    try {
      rzpOrder = await getRazorpay().orders.create({
        amount,
        currency: CURRENCY,
        receipt: String(order._id),
        notes: { orderId: String(order._id) },
      })
    } catch (err) {
      await Order.updateOne(
        { _id: order._id, razorpayCreateRequestId: createRequestId },
        { $unset: { razorpayCreateRequestId: 1, paymentProvider: 1 } },
      )
      throw err
    }

    const saved = await Order.findOneAndUpdate(
      { _id: order._id, status: 'pending', razorpayCreateRequestId: createRequestId, razorpayOrderId: { $exists: false } },
      { $set: { razorpayOrderId: rzpOrder.id }, $unset: { razorpayCreateRequestId: 1 } },
      { new: true },
    )
    const current = saved || await Order.findById(order._id)
    if (!current || current.status !== 'pending' || !current.razorpayOrderId) {
      return res.status(409).json({ message: 'This order can no longer be paid' })
    }
    res.json(reply(current.razorpayOrderId))
  } catch (err) {
    console.error('Razorpay order error:', err?.error?.description || err.message)
    res.status(500).json({ message: 'Unable to start payment. Please try again.' })
  }
})

// VERIFY a payment after the Razorpay popup reports success in the browser.
router.post('/:id/razorpay-verify', protect, paymentLimiter, async (req, res) => {
  try {
    if (!isRazorpayEnabled()) return res.status(503).json({ message: 'Razorpay payment is not available right now.' })
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid order ID' })

    const rzpOrderId = String(req.body.razorpay_order_id || '').trim()
    const rzpPaymentId = String(req.body.razorpay_payment_id || '').trim()
    const signature = String(req.body.razorpay_signature || '').trim()
    if (!/^order_[A-Za-z0-9]{6,40}$/.test(rzpOrderId) || !/^pay_[A-Za-z0-9]{6,40}$/.test(rzpPaymentId) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return res.status(400).json({ message: 'Missing Razorpay payment details' })
    }

    const order = await Order.findById(req.params.id)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== req.userId) return res.status(403).json({ message: 'Not authorized to pay for this order' })
    if (order.razorpayOrderId !== rzpOrderId) return res.status(409).json({ message: 'This Razorpay order does not belong to this checkout' })

    // The webhook may already have confirmed it - that is a success for the buyer.
    if (order.status === 'paid' && order.razorpayPaymentId === rzpPaymentId) return res.json({ status: 'paid' })
    if (order.status !== 'pending') return res.status(409).json({ message: `This order is already ${order.status} and cannot be paid again.` })

    if (!verifyPaymentSignature(rzpOrderId, rzpPaymentId, signature)) {
      return res.status(400).json({ message: 'Payment verification failed' })
    }

    // Never rely on the browser: read the payment from Razorpay itself.
    const razorpay = getRazorpay()
    let payment = await razorpay.payments.fetch(rzpPaymentId)
    if (payment.order_id !== rzpOrderId) return res.status(409).json({ message: 'Payment does not match this order' })
    if (payment.currency !== CURRENCY || Number(payment.amount) !== moneyToSen(order.totalAmount)) {
      return res.status(409).json({ message: 'Payment amount does not match this order' })
    }
    if (payment.status === 'authorized') payment = await razorpay.payments.capture(rzpPaymentId, payment.amount, payment.currency)

    const result = await settleRazorpayPayment(payment)
    if (!result.ok) {
      return res.status(409).json({ message: 'We could not confirm this payment yet. If money was deducted, the order will be confirmed automatically shortly.' })
    }
    res.json({ status: result.order.status })
  } catch (err) {
    console.error('Razorpay verify error:', err?.error?.description || err.message)
    res.status(500).json({ message: 'Unable to confirm payment. If money was deducted, the order will be confirmed automatically shortly.' })
  }
})

module.exports = router
