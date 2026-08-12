// const nodemailer = require('nodemailer')

// const isConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS)
// const transporter = isConfigured
//   ? nodemailer.createTransport({
//       host: 'smtp.gmail.com',
//       port: 465,
//       secure: true,
//       family: 4, // force IPv4 - Render's IPv6 route to Gmail is unreachable
//       auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
//       pool: true,
//       maxConnections: 2,
//       connectionTimeout: 8000,
//       greetingTimeout: 8000,
//       socketTimeout: 10000,
//     })
//   : null

// async function sendNotification({ subject, text, replyTo }) {
//   if (!transporter) {
//     const error = new Error('Email service is not configured')
//     error.code = 'EMAIL_NOT_CONFIGURED'
//     throw error
//   }
//   return transporter.sendMail({
//     from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
//     to: process.env.CONTACT_RECIPIENT || 'antony.s8637@gmail.com',
//     subject,
//     text,
//     replyTo,
//   })
// }

// module.exports = { sendNotification, isConfigured }


async function sendNotification({ subject, text, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    const error = new Error('Email service is not configured')
    error.code = 'EMAIL_NOT_CONFIGURED'
    throw error
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Ayusydah <onboarding@resend.dev>',
      to: process.env.CONTACT_RECIPIENT || 'antony.s8637@gmail.com',
      subject,
      text,
      reply_to: replyTo,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Resend API error: ${response.status} ${errorBody}`)
  }

  return response.json()
}

const isConfigured = Boolean(process.env.RESEND_API_KEY)

module.exports = { sendNotification, isConfigured }