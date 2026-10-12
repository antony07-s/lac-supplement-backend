const { randomUUID } = require('crypto')
const Order = require('../models/Order')
const { getRazorpay, CURRENCY } = require('./razorpay')
const { PAYPAL_BASE, getPayPalAccessToken } = require('./paypal')
const { moneyToSen } = require('./checkout')

const REFUNDABLE_STATUSES = ['paid', 'shipped', 'delivered', 'cancelled']

function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}

async function processFullRefund(orderId, note) {
  const requestId = randomUUID()
  let refundAttempted = false
  const order = await Order.findOneAndUpdate({
    _id: orderId,
    status: { $in: REFUNDABLE_STATUSES },
    $or: [
      { refundStatus: { $in: ['not-requested', 'failed'] } },
      { refundStatus: { $exists: false } },
      { refundStatus: 'reconciliation-required', refundRequestedAt: null, paymentIssue: 'late_capture' },
    ],
    paymentProcessing: { $ne: true },
  }, {
    $set: { refundStatus: 'processing', refundRequestId: requestId, refundRequestedAt: new Date(), refundLastError: '', statusNote: note },
  }, { new: true })

  if (!order) {
    const current = await Order.findById(orderId)
    if (!current) throw httpError(404, 'Order not found')
    if (current.refundStatus === 'processing' || current.refundStatus === 'pending' || current.refundStatus === 'reconciliation-required') {
      throw httpError(409, 'A refund is already in progress or needs reconciliation; it will not be submitted again automatically.')
    }
    throw httpError(409, 'This order is not eligible for a refund.')
  }
  if (order.status === 'cancelled' && order.paymentIssue !== 'late_capture') {
    await Order.updateOne({ _id: order._id, refundRequestId: requestId }, { $set: { refundStatus: 'failed', refundLastError: 'Cancelled orders without a late captured payment are not refundable.' } })
    throw httpError(409, 'This cancelled order has no verified late payment to refund.')
  }

  try {
    if (order.paymentProvider === 'razorpay' && order.razorpayPaymentId) {
      const razorpay = getRazorpay()
      const payment = await razorpay.payments.fetch(order.razorpayPaymentId)
      if (payment.order_id !== order.razorpayOrderId || payment.currency !== CURRENCY || Number(payment.amount) !== moneyToSen(order.totalAmount)) {
        throw httpError(409, 'The provider payment does not match this order; reconciliation is required.')
      }
      if (payment.refund_status === 'full' || payment.status === 'refunded') {
        return await finishRefund(order, null, 'completed')
      }
      if (payment.status !== 'captured' || Number(payment.amount_refunded || 0) !== 0) {
        throw httpError(409, 'Only an unrefunded, captured payment can be fully refunded automatically.')
      }
      refundAttempted = true
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        receipt: `order-${String(order._id).slice(-24)}`,
        notes: { orderId: String(order._id), requestId },
      })
      if (refund.payment_id !== order.razorpayPaymentId || Number(refund.amount) !== moneyToSen(order.totalAmount)) {
        throw httpError(502, 'Razorpay returned refund details that do not match this order.')
      }
      return await finishRefund(order, refund.id, refund.status === 'processed' ? 'completed' : refund.status === 'failed' ? 'failed' : 'pending')
    }

    if (order.paymentProvider === 'paypal' && order.paypalCaptureId) {
      const accessToken = await getPayPalAccessToken()
      const paymentResponse = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(order.paypalCaptureId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!paymentResponse.ok) throw httpError(502, 'Unable to verify the PayPal capture before refunding.')
      const capture = await paymentResponse.json()
      if (capture.id !== order.paypalCaptureId || capture.amount?.currency_code !== CURRENCY || moneyToSen(capture.amount?.value) !== moneyToSen(order.totalAmount)) {
        throw httpError(409, 'The provider payment does not match this order; reconciliation is required.')
      }
      if (capture.status === 'REFUNDED') return await finishRefund(order, null, 'completed')
      if (capture.status !== 'COMPLETED') throw httpError(409, 'PayPal has not confirmed a completed capture for this order.')
      refundAttempted = true
      const response = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(order.paypalCaptureId)}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
        body: JSON.stringify({ note_to_payer: String(note).slice(0, 255), custom_id: String(order._id) }),
      })
      if (!response.ok) throw httpError(502, `PayPal refund request could not be confirmed (HTTP ${response.status}).`)
      const refund = await response.json()
      if (refund.amount?.currency_code !== CURRENCY || moneyToSen(refund.amount?.value) !== moneyToSen(order.totalAmount)) {
        throw httpError(502, 'PayPal returned refund details that do not match this order.')
      }
      return await finishRefund(order, refund.id, refund.status === 'COMPLETED' ? 'completed' : refund.status === 'FAILED' ? 'failed' : 'pending')
    }

    throw httpError(409, 'No verified captured payment is linked to this order. It cannot be marked refunded.')
  } catch (error) {
    const safeMessage = String(error.message || 'Provider refund could not be confirmed').slice(0, 500)
    const uncertain = refundAttempted || error.status === 502 || !error.status
    await Order.updateOne({ _id: order._id, refundRequestId: requestId }, {
      $set: {
        refundStatus: uncertain ? 'reconciliation-required' : 'failed',
        refundLastError: safeMessage,
        ...(uncertain && { paymentIssue: 'refund_reconciliation' }),
      },
    })
    throw error
  }
}

async function finishRefund(order, refundId, state) {
  const update = {
    refundStatus: state,
    refundLastError: '',
    ...(refundId && { refundId }),
    ...(state === 'completed' && { status: 'refunded', refundCompletedAt: new Date(), paymentIssue: null }),
  }
  const saved = await Order.findOneAndUpdate({ _id: order._id, refundRequestId: order.refundRequestId }, { $set: update }, { new: true })
  if (!saved) throw httpError(409, 'Refund state changed; reload the order before continuing.')
  return saved
}

async function reconcileRefund(orderId) {
  const order = await Order.findById(orderId)
  if (!order) throw httpError(404, 'Order not found')
  if (!['pending', 'reconciliation-required'].includes(order.refundStatus)) {
    throw httpError(409, 'This refund is not awaiting reconciliation.')
  }

  if (order.paymentProvider === 'razorpay' && order.razorpayPaymentId) {
    const gateway = getRazorpay()
    const payment = await gateway.payments.fetch(order.razorpayPaymentId)
    if (payment.order_id === order.razorpayOrderId && payment.currency === CURRENCY
      && Number(payment.amount) === moneyToSen(order.totalAmount)
      && Number(payment.amount_refunded || 0) === moneyToSen(order.totalAmount) && payment.refund_status === 'full') {
      const saved = await Order.findOneAndUpdate({ _id: order._id }, { $set: { status: 'refunded', refundStatus: 'completed', refundCompletedAt: new Date(), refundLastError: '', paymentIssue: null } }, { new: true })
      return saved
    }
    if (order.refundId) {
      const refund = await gateway.payments.fetchRefund(order.razorpayPaymentId, order.refundId)
      const state = refund.status === 'processed' ? 'completed' : refund.status === 'failed' ? 'failed' : 'pending'
      return finishRefund(order, refund.id, state)
    }
    const refunds = await gateway.payments.fetchMultipleRefund(order.razorpayPaymentId, { count: 100 })
    const match = (refunds.items || []).find((refund) => refund.notes?.requestId === order.refundRequestId && refund.notes?.orderId === String(order._id))
    if (!match) throw httpError(409, 'Razorpay has no verifiable refund record yet. No second refund was submitted.')
    const state = match.status === 'processed' ? 'completed' : match.status === 'failed' ? 'failed' : 'pending'
    return finishRefund(order, match.id, state)
  }

  if (order.paymentProvider === 'paypal' && order.paypalCaptureId) {
    const accessToken = await getPayPalAccessToken()
    const captureResponse = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(order.paypalCaptureId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!captureResponse.ok) throw httpError(502, 'Unable to verify the PayPal capture during refund reconciliation.')
    const capture = await captureResponse.json()
    const refunded = capture.seller_receivable_breakdown?.total_refunded_amount
    if (capture.id === order.paypalCaptureId && capture.amount?.currency_code === CURRENCY
      && moneyToSen(capture.amount.value) === moneyToSen(order.totalAmount)
      && capture.status === 'REFUNDED' && refunded?.currency_code === CURRENCY && moneyToSen(refunded.value) === moneyToSen(order.totalAmount)) {
      return Order.findOneAndUpdate({ _id: order._id }, { $set: { status: 'refunded', refundStatus: 'completed', refundCompletedAt: new Date(), refundLastError: '', paymentIssue: null } }, { new: true })
    }
    if (moneyToSen(refunded?.value || 0) > 0) throw httpError(409, 'The provider reports a partial refund. Manual reconciliation is required; no additional refund was submitted.')
    if (order.refundId) {
      const response = await fetch(`${PAYPAL_BASE}/v2/payments/refunds/${encodeURIComponent(order.refundId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw httpError(502, 'Unable to verify the PayPal refund status.')
      const refund = await response.json()
      return finishRefund(order, refund.id, refund.status === 'COMPLETED' ? 'completed' : refund.status === 'FAILED' ? 'failed' : 'pending')
    }
    // PayPal's request id is a provider-supported idempotency key. Replaying
    // the identical full-refund request is safe after a lost response.
    const response = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(order.paypalCaptureId)}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': order.refundRequestId, Prefer: 'return=representation' },
      body: JSON.stringify({ note_to_payer: String(order.statusNote || '').slice(0, 255), custom_id: String(order._id) }),
    })
    if (!response.ok) throw httpError(502, 'PayPal refund reconciliation is still unavailable.')
    const refund = await response.json()
    if (refund.amount?.currency_code !== CURRENCY || moneyToSen(refund.amount?.value) !== moneyToSen(order.totalAmount)) throw httpError(409, 'PayPal refund details do not match this order.')
    return finishRefund(order, refund.id, refund.status === 'COMPLETED' ? 'completed' : refund.status === 'FAILED' ? 'failed' : 'pending')
  }
  throw httpError(409, 'The provider payment details are unavailable for refund reconciliation.')
}

async function applyProviderRefund(order, refund, provider) {
  if (!order || !refund) return false
  if (provider === 'razorpay' && (refund.payment_id !== order.razorpayPaymentId || refund.currency !== CURRENCY || Number(refund.amount) !== moneyToSen(order.totalAmount))) return false
  if (provider === 'paypal' && (refund.amount?.currency_code !== CURRENCY || moneyToSen(refund.amount?.value) !== moneyToSen(order.totalAmount))) return false
  const state = (refund.status === 'processed' || refund.status === 'COMPLETED') ? 'completed'
    : (refund.status === 'failed' || refund.status === 'FAILED') ? 'failed' : 'pending'
  const update = { refundStatus: state, ...(refund.id && { refundId: refund.id }), refundLastError: '' }
  if (state === 'completed') Object.assign(update, { status: 'refunded', refundCompletedAt: new Date(), paymentIssue: null })
  await Order.updateOne({ _id: order._id }, { $set: update })
  return true
}

module.exports = { processFullRefund, reconcileRefund, applyProviderRefund }
