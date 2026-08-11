const nodemailer = require('nodemailer')

const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS)
const transporter = isConfigured
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null

async function sendNotification({ subject, text, replyTo }) {
  if (!transporter) {
    const error = new Error('Email service is not configured')
    error.code = 'EMAIL_NOT_CONFIGURED'
    throw error
  }
  return transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: process.env.CONTACT_RECIPIENT || 'antony.s8637@gmail.com',
    subject,
    text,
    replyTo,
  })
}

module.exports = { sendNotification, isConfigured }
