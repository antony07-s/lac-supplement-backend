const crypto = require('crypto')
const Razorpay = require('razorpay')
const Order = require('../models/Order')
const User = require('../models/User')
const { moneyToSen } = require('./checkout')
const { sendOrderPaidEmails } = require('./notify')

// The store prices everything in Malaysian ringgit, so Razorpay charges MYR too.
// (Needs "International Payments" approved on the Razorpay account.)
const CURRENCY = 'MYR'

function isRazorpayEnabled() {
  return process.env.RAZORPAY_ENABLED === 'true'
    && Boolean(process.env.RAZORPAY_KEY_ID)
    && Boolean(process.env.RAZORPAY_KEY_SECRET)
    // Webhooks are the durable confirmation path if the buyer closes the tab.
    && Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
}

let client
function getRazorpay() {
  if (!isRazorpayEnabled()) throw Object.assign(new Error('Razorpay is not enabled'), { status: 503 })
  if (!client) client = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  return client
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8')
  const y = Buffer.from(String(b || ''), 'utf8')
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// Browser-side proof: HMAC-SHA256 of "razorpay_order_id|razorpay_payment_id" with the key secret.
function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature) {
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex')
  return safeEqual(expected, signature)
}

// Webhook proof: HMAC-SHA256 of the RAW request body with the webhook secret.
function verifyWebhookSignature(rawBody, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex')
  return safeEqual(expected, signature)
}

// Shared by the browser-verify route and the webhook, so an order is marked
// paid exactly once and the paid emails are sent exactly once.
async function settleRazorpayPayment(payment) {
  if (!payment || payment.status !== 'captured') return { ok: false, reason: 'not-captured' }
  const order = await Order.findOne({ razorpayOrderId: payment.order_id })
  if (!order) return { ok: false, reason: 'order-not-found' }

  if (payment.currency !== CURRENCY || Number(payment.amount) !== moneyToSen(order.totalAmount)) {
    console.error(`Razorpay payment ${payment.id} does not match order ${order._id}`)
    return { ok: false, reason: 'mismatch', order }
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending' },
    { $set: { status: 'paid', razorpayPaymentId: payment.id, paymentProvider: 'razorpay' } },
    { new: true },
  )

  if (!updated) {
    const alreadyThisPayment = order.status === 'paid' && order.razorpayPaymentId === payment.id
    if (!alreadyThisPayment) {
      console.warn(`Razorpay payment ${payment.id} arrived for order ${order._id} in status "${order.status}" - check it and refund manually if needed`)
    }
    return { ok: alreadyThisPayment, reason: 'not-pending', order, transitioned: false }
  }

  User.findById(updated.user).select('email').lean()
    .then((buyer) => sendOrderPaidEmails(updated, buyer?.email))
    .catch((err) => console.error('Order notification error:', err.message))

  return { ok: true, order: updated, transitioned: true }
}

module.exports = { CURRENCY, isRazorpayEnabled, getRazorpay, verifyPaymentSignature, verifyWebhookSignature, settleRazorpayPayment }
