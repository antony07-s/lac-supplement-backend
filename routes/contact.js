const express = require('express')
const router = express.Router()
const nodemailer = require('nodemailer')
const Message = require('../models/Message')

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body
    if (!name || !email || !message) {
      return res.status(400).json({ message: 'Name, email, and message are required' })
    }

    const saved = await Message.create({ name, email, subject, message })

    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      replyTo: email,
      subject: `New contact form message: ${subject || 'No subject'}`,
      text: `From: ${name} (${email})\n\n${message}`,
    }).catch((err) => console.error('Email send failed:', err))

    res.status(201).json({ message: 'Message sent', saved })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router