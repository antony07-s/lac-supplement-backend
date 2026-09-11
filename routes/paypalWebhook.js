const express = require('express')
const router = express.Router()
const Order = require('../models/Order')
const { PAYPAL_BASE, getPayPalAccessToken } = require('../utils/paypal')
const { moneyToSen } = require('../utils/checkout')

// Reconciliation for captures that succeed at PayPal but whose browser loses
// the response. PayPal's signature is verified before any database update.
router.post('/', express.json({ limit: '100kb' }), async (req, res) => {
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
    if (req.body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = req.body.resource || {}
      const paypalOrderId = capture.supplementary_data?.related_ids?.order_id
      const order = await Order.findOne({ paypalOrderId, status: 'pending' })
      if (order && capture.status === 'COMPLETED' && capture.amount?.currency_code === 'MYR' && moneyToSen(capture.amount.value) === moneyToSen(order.totalAmount)) {
        order.status = 'paid'; order.paypalCaptureId = capture.id; order.paymentProvider = 'paypal'
        await order.save()
      }
    }
    res.json({ received: true })
  } catch (error) {
    console.error('PayPal webhook processing failed:', error.message)
    res.status(500).send('Webhook processing failed')
  }
})
module.exports = router
