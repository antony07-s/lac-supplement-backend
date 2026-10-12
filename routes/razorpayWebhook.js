const express = require('express')
const router = express.Router()
const { verifyWebhookSignature, settleRazorpayPayment, getRazorpay, CURRENCY } = require('../utils/razorpay')
const { moneyToSen } = require('../utils/checkout')
const Order = require('../models/Order')
const { claimPaymentEvent, completePaymentEvent, failPaymentEvent } = require('../utils/paymentEvents')
const { applyProviderRefund } = require('../utils/refunds')

// Backup confirmation for buyers who pay but close the tab before the browser
// calls /razorpay-verify. express.raw keeps the exact bytes Razorpay signed.
// This router must be mounted BEFORE express.json() in server.js.
router.post('/', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  let receipt
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send('Razorpay webhook not configured')
    const signature = req.get('x-razorpay-signature')
    if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
      return res.status(400).send('Invalid webhook signature')
    }

    const event = JSON.parse(req.body.toString('utf8'))
    const eventId = req.get('x-razorpay-event-id')
    if (!eventId) return res.status(400).send('Missing Razorpay event ID')
    const claim = await claimPaymentEvent('razorpay', eventId, event.event)
    if (!claim.claimed) return res.json({ received: true, duplicate: true })
    receipt = claim.event

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const paymentId = event.payload?.payment?.entity?.id
      const orderId = event.payload?.order?.entity?.id
      const gateway = getRazorpay()
      const paymentIds = paymentId ? [paymentId] : orderId
        ? (await gateway.orders.fetchPayments(orderId)).items.filter((item) => item.status === 'captured').map((item) => item.id)
        : []
      for (const id of paymentIds) {
        const verifiedPayment = await gateway.payments.fetch(id)
        await settleRazorpayPayment(verifiedPayment)
      }
    } else if (event.event === 'payment.refunded') {
      const entity = event.payload?.payment?.entity
      const order = await Order.findOne({ razorpayPaymentId: entity?.id })
      if (order && entity?.id) {
        const payment = await getRazorpay().payments.fetch(entity.id)
        const fullyRefunded = payment.status === 'refunded' && payment.refund_status === 'full'
          && payment.order_id === order.razorpayOrderId && payment.currency === CURRENCY
          && Number(payment.amount) === moneyToSen(order.totalAmount) && Number(payment.amount_refunded) === moneyToSen(order.totalAmount)
        if (fullyRefunded) await Order.updateOne({ _id: order._id }, { $set: { status: 'refunded', refundStatus: 'completed', refundCompletedAt: new Date(), refundLastError: '', paymentIssue: null } })
        else await Order.updateOne({ _id: order._id }, { $set: { refundStatus: 'reconciliation-required', paymentIssue: 'refund_reconciliation' } })
      }
    } else if (event.event === 'refund.processed' || event.event === 'refund.failed') {
      const refundEntity = event.payload?.refund?.entity
      const order = await Order.findOne({ razorpayPaymentId: refundEntity?.payment_id })
      if (order && refundEntity?.id) {
        const verifiedRefund = await getRazorpay().payments.fetchRefund(refundEntity.payment_id, refundEntity.id)
        await applyProviderRefund(order, verifiedRefund, 'razorpay')
      }
    }
    await completePaymentEvent(receipt)
    res.json({ received: true })
  } catch (error) {
    if (receipt) await failPaymentEvent(receipt, error)
    console.error('Razorpay webhook processing failed:', error.message)
    res.status(500).send('Webhook processing failed')
  }
})

module.exports = router
