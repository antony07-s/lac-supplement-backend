const express = require('express')
const router = express.Router()
const Stripe = require('stripe')
const Order = require('../models/Order')

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

// IMPORTANT: this route must receive the RAW request body (not JSON-parsed)
// so Stripe's signature can be verified. It is mounted in server.js with
// express.raw({ type: 'application/json' }) BEFORE the global express.json() middleware.
router.post('/', async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook received but Stripe is not configured')
    return res.status(503).send('Stripe not configured')
  }

  const signature = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const orderId = session.metadata?.orderId
      if (orderId) {
        // Only move pending -> paid. Prevents a replayed/duplicate webhook
        // from doing anything once the order has already progressed.
        await Order.findOneAndUpdate(
          { _id: orderId, status: 'pending' },
          { status: 'paid', stripePaymentIntentId: session.payment_intent || undefined },
        )
      }
    }
    // Acknowledge receipt so Stripe doesn't retry. Any event type we don't
    // handle above is intentionally ignored.
    res.json({ received: true })
  } catch (err) {
    console.error('Error handling Stripe webhook:', err.message)
    // Returning 500 tells Stripe to retry this event later.
    res.status(500).send('Webhook handler error')
  }
})

module.exports = router