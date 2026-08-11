const express = require('express')
const router = express.Router()
const Subscriber = require('../models/Subscriber')
const { sendNotification } = require('../config/mailer')

router.post('/', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      return res.status(400).json({ message: 'Enter a valid email address' })
    }

    let subscriber = await Subscriber.findOne({ email })
    const isNew = !subscriber
    if (!subscriber) {
      subscriber = await Subscriber.create({ email })
    }

    if (!subscriber.notificationSentAt) {
      void sendNotification({
        subject: `New newsletter subscriber: ${email}`,
        text: `A visitor subscribed to the Ayusydah newsletter.\n\nEmail: ${email}`,
      })
        .then(async () => {
          subscriber.notificationSentAt = new Date()
          await subscriber.save()
        })
        .catch((error) => console.error('Newsletter notification failed:', error.message))
    }

    res.status(isNew ? 201 : 200).json({ message: isNew ? 'Subscription confirmed' : 'You are already subscribed' })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ message: 'Already subscribed' })
    }
    res.status(500).json({ message: 'Unable to save subscription' })
  }
})

module.exports = router
