const express = require('express')
const rateLimit = require('express-rate-limit')
const router = express.Router()
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many messages sent. Please try again later.' } })
const crypto = require('crypto')
const Message = require('../models/Message')
const { sendNotification, contactThankYouHtml, contactAdminAlertHtml } = require('../config/mailer')

router.post('/', contactLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const subject = String(req.body.subject || '').trim()
    const message = String(req.body.message || '').trim()
    if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email) || !subject || subject.length > 200 || !message || message.length > 5000) {
      return res.status(400).json({ message: 'Complete all fields with valid details before sending' })
    }
    const fingerprint = crypto.createHash('sha256').update(`${email}\n${subject}\n${message}`).digest('hex')
    const duplicateSince = new Date(Date.now() - 5 * 60 * 1000)
    const duplicate = await Message.exists({ fingerprint, createdAt: { $gte: duplicateSince } })
    if (duplicate) return res.status(409).json({ message: 'This enquiry was already sent. We will get back to you shortly.' })

    const saved = await Message.create({ name, email, subject, message, fingerprint })

    void sendNotification({
      replyTo: email,
      subject: `New contact form message: ${subject || 'No subject'}`,
      text: `From: ${name} (${email})\n\n${message}`,
      html: contactAdminAlertHtml(name, email, subject, message),
    }).catch((error) => console.error('Contact notification failed:', error.message))

    void sendNotification({
      to: email,
      subject: 'We received your message — AYUSYDAH',
      text: `Hi ${name},\n\nThank you for contacting AYUSYDAH. We received your message about "${subject}" and our team will respond soon.\n\nKind regards,\nAYUSYDAH`,
      html: contactThankYouHtml(name, subject),
    }).catch((error) => console.error('Contact thank-you email failed:', error.message))

    res.status(201).json({ message: 'Message sent', id: saved._id })
  } catch (err) {
    console.error('Contact submission failed:', err.message)
    res.status(500).json({ message: 'Unable to save your enquiry' })
  }
})

module.exports = router
