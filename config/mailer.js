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


function verificationEmailHtml(code) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your email</title></head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(20,37,63,.08);">
      <tr><td style="background:#123f7a;padding:28px 36px;text-align:center;"><span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:.4px;">AYUSYDAH<span style="color:#d7ac54;">.</span></span></td></tr>
      <tr><td style="padding:36px 36px 28px;"><h1 style="margin:0 0 12px;font-size:24px;line-height:32px;color:#182235;">Verify your email address</h1><p style="margin:0;color:#5c6677;font-size:15px;line-height:24px;">Thank you for joining AYUSYDAH. Enter this verification code on the registration page to create your account.</p>
        <div style="margin:28px 0;background:#f3f6fc;border:1px solid #dce5f4;border-radius:12px;padding:20px;text-align:center;"><span style="font-size:30px;line-height:36px;font-weight:700;letter-spacing:8px;color:#123f7a;">${code}</span></div>
        <p style="margin:0;color:#5c6677;font-size:14px;line-height:22px;">This code expires in <strong style="color:#182235;">10 minutes</strong>. For your security, do not share it with anyone.</p>
      </td></tr>
      <tr><td style="border-top:1px solid #edf0f5;padding:20px 36px;color:#8791a1;font-size:12px;line-height:18px;text-align:center;">If you did not request this account, you can safely ignore this email.<br>© ${new Date().getFullYear()} AYUSYDAH. All rights reserved.</td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

async function sendNotification({ subject, text, html, replyTo, to }) {
  if (!process.env.RESEND_API_KEY) {
    const error = new Error('Email service is not configured')
    error.code = 'EMAIL_NOT_CONFIGURED'
    throw error
  }

  const configuredRecipient = process.env.CONTACT_RECIPIENT?.trim()
  const recipient = to || configuredRecipient || 'antony.s8637@gmail.com'

  if (!to && !configuredRecipient) {
    console.error(
      'CRITICAL EMAIL CONFIGURATION WARNING: CONTACT_RECIPIENT is missing. '
      + 'Admin notification is falling back to antony.s8637@gmail.com. '
      + 'Set CONTACT_RECIPIENT immediately.',
    )
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Ayusydah <onboarding@resend.dev>',
      to: recipient,
      subject,
      text,
      html,
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

module.exports = { sendNotification, verificationEmailHtml, isConfigured }
