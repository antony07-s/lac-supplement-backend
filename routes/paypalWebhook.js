const express = require('express')
const router = express.Router()
const Order = require('../models/Order')
const { PAYPAL_BASE, getPayPalAccessToken, settlePayPalCapture } = require('../utils/paypal')
const { moneyToSen } = require('../utils/checkout')
const { claimPaymentEvent, completePaymentEvent, failPaymentEvent } = require('../utils/paymentEvents')
const { reconcileRefund, finishRefund } = require('../utils/refunds')

// Reconciliation for captures that succeed at PayPal but whose browser loses
// the response. PayPal's signature is verified before any database update.
router.post('/', express.json({ limit: '100kb' }), async (req, res) => {
  let receipt
  try {
    if (!process.env.PAYPAL_WEBHOOK_ID) return res.status(503).send('PayPal webhook not configured')
    const accessToken = await getPayPalAccessToken()
    const verification = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: req.get('paypal-auth-algo'), cert_url: req.get('paypal-cert-url'), transmission_id: req.get('paypal-transmission-id'),
        transmission_sig: req.get('paypal-transmission-sig'), transmission_time: req.get('paypal-transmission-time'), webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: req.body,
      }),
    })
    const result = verification.ok ? await verification.json() : null
    if (result?.verification_status !== 'SUCCESS') return res.status(400).send('Invalid webhook signature')
    const eventId = req.body.id
    const claim = await claimPaymentEvent('paypal', eventId, req.body.event_type)
    if (!claim.claimed) return res.json({ received: true, duplicate: true })
    receipt = claim.event

    if (req.body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = req.body.resource || {}
      const paypalOrderId = capture.supplementary_data?.related_ids?.order_id
      const order = await Order.findOne({ paypalOrderId })
      if (order && capture.id) await settlePayPalCapture(order, capture.id)
    } else if (req.body.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
      const resource = req.body.resource || {}
      const relatedIds = resource.supplementary_data?.related_ids || {}
      const relatedOrderId = relatedIds.order_id
      const hintedCaptureId = relatedIds.capture_id || resource.capture_id
      let order = relatedOrderId ? await Order.findOne({ paypalOrderId: relatedOrderId }) : null
      if (!order && hintedCaptureId) order = await Order.findOne({ paypalCaptureId: hintedCaptureId })
      if (!order && resource.id) order = await Order.findOne({ refundId: resource.id, paymentProvider: 'paypal' })
      if (!order && resource.id) order = await Order.findOne({ paypalCaptureId: resource.id })
      const captureId = order?.paypalCaptureId || hintedCaptureId || (order && resource.id === order.paypalCaptureId ? resource.id : null)
      if (order && captureId) {
        const accessToken = await getPayPalAccessToken()
        const captureResponse = await fetch(`${PAYPAL_BASE}/v2/payments/captures/${encodeURIComponent(captureId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (!captureResponse.ok) throw new Error('Unable to verify the refunded PayPal capture')
        const capture = await captureResponse.json()
        const refunded = capture.seller_receivable_breakdown?.total_refunded_amount
        const fullyRefunded = capture.id === captureId && capture.status === 'REFUNDED'
          && capture.amount?.currency_code === 'MYR' && moneyToSen(capture.amount.value) === moneyToSen(order.totalAmount)
          && refunded?.currency_code === 'MYR' && moneyToSen(refunded.value) === moneyToSen(order.totalAmount)
        if (fullyRefunded) {
          await finishRefund(order, resource.id !== captureId ? resource.id : order.refundId, 'completed')
        } else if (moneyToSen(refunded?.value || 0) > 0) {
          await Order.updateOne({ _id: order._id }, { $set: { paypalCaptureId: captureId, refundStatus: 'reconciliation-required', paymentIssue: 'refund_reconciliation' } })
        } else if (['pending', 'reconciliation-required'].includes(order.refundStatus)) {
          await reconcileRefund(order._id)
        }
      }
    }
    await completePaymentEvent(receipt)
    res.json({ received: true })
  } catch (error) {
    if (receipt) await failPaymentEvent(receipt, error)
    console.error('PayPal webhook processing failed:', error.message)
    res.status(500).send('Webhook processing failed')
  }
})
module.exports = router
