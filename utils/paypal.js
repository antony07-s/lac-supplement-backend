const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

const Order = require('../models/Order')
const User = require('../models/User')
const { moneyToSen } = require('./checkout')
const { sendOrderPaidEmails } = require('./notify')
const { evaluateCapture } = require('./paymentState')

async function getPayPalAccessToken() {
  if (process.env.NODE_ENV === 'production' && process.env.PAYPAL_ENV !== 'live') {
    throw new Error('PayPal must use PAYPAL_ENV=live in production')
  }
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials are not configured')
  }
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
  console.error('PayPal token request failed:', res.status)
  throw new Error('Failed to get PayPal access token')
}

  const data = await res.json()
  return data.access_token
}

async function settlePayPalCapture(order, captureId) {
  const accessToken = await getPayPalAccessToken()
  const response = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return { ok: false, reason: 'provider-unavailable' }
  const capture = await response.json()
  if (capture.id !== captureId) return { ok: false, reason: 'mismatch' }
  const decision = evaluateCapture({
    order,
    payment: { id: capture.id, status: capture.status, currency: capture.amount?.currency_code, amount: moneyToSen(capture.amount?.value || 0) },
    providerOrderId: order.paypalOrderId,
    paymentOrderId: capture.supplementary_data?.related_ids?.order_id,
    currency: 'MYR',
    expectedAmount: moneyToSen(order.totalAmount),
  })
  if (decision === 'mismatch') {
    if (capture.status === 'COMPLETED') {
      await Order.updateOne({ _id: order._id }, { $set: { paymentIssue: 'provider_mismatch', refundStatus: 'reconciliation-required' } })
      return { ok: false, reason: 'mismatch' }
    }
    return { ok: false, reason: 'not-captured' }
  }
  if (decision === 'not-captured') return { ok: false, reason: 'not-captured' }
  if (decision === 'duplicate') return { ok: true, reason: 'duplicate', order, transitioned: false }
  const paid = await Order.findOneAndUpdate(
    { _id: order._id, paypalOrderId: order.paypalOrderId, status: 'pending', stockReserved: true },
    { $set: { status: 'paid', paypalCaptureId: capture.id, paymentProvider: 'paypal', paymentProcessing: false, paymentProcessingSince: null } },
    { returnDocument: 'after' },
  )
  if (paid) {
    User.findById(paid.user).select('email').lean()
      .then((buyer) => sendOrderPaidEmails(paid, buyer?.email))
      .catch((err) => console.error('Order notification error:', err.message))
    return { ok: true, order: paid, transitioned: true }
  }
  const current = await Order.findById(order._id)
  if (current?.status === 'paid' && current.paypalCaptureId === capture.id) return { ok: true, order: current, transitioned: false }
  await Order.updateOne({ _id: order._id, paypalCaptureId: { $in: [null, capture.id] } }, {
    $set: { paypalCaptureId: capture.id, paymentIssue: 'late_capture', refundStatus: 'reconciliation-required', paymentProcessing: false, paymentProcessingSince: null },
  })
  console.error(`PayPal captured payment ${capture.id} requires reconciliation for order ${order._id}`)
  return { ok: false, reason: 'late-capture', order: current }
}

module.exports = { PAYPAL_BASE, getPayPalAccessToken, settlePayPalCapture }
