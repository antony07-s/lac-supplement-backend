const express = require('express')
const router = express.Router()
const { verifyWebhookSignature, settleRazorpayPayment } = require('../utils/razorpay')

// Backup confirmation for buyers who pay but close the tab before the browser
// calls /razorpay-verify. express.raw keeps the exact bytes Razorpay signed.
// This router must be mounted BEFORE express.json() in server.js.
router.post('/', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  try {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).send('Razorpay webhook not configured')
    const signature = req.get('x-razorpay-signature')
    if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
      return res.status(400).send('Invalid webhook signature')
    }

    const event = JSON.parse(req.body.toString('utf8'))
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      await settleRazorpayPayment(event.payload?.payment?.entity)
    }
    res.json({ received: true })
  } catch (error) {
    console.error('Razorpay webhook processing failed:', error.message)
    res.status(500).send('Webhook processing failed')
  }
})

module.exports = router
