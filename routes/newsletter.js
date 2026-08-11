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
      await sendNotification({
        subject: `New newsletter subscriber: ${email}`,
        text: `A visitor subscribed to the Ayusydah newsletter.\n\nEmail: ${email}`,
      })
      subscriber.notificationSentAt = new Date()
      await subscriber.save()
    }

    res.status(isNew ? 201 : 200).json({ message: isNew ? 'Subscription confirmed' : 'You are already subscribed' })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ message: 'Already subscribed' })
    }
    if (err.code === 'EMAIL_NOT_CONFIGURED') {
      return res.status(503).json({ message: 'Subscription saved, but email notifications are not configured yet' })
    }
    console.error('Newsletter notification failed:', err.message)
    res.status(502).json({ message: 'Subscription saved, but the notification email could not be delivered' })
  }
})

module.exports = router
