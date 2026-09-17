// utils/notify.js
// Handles all order-related email notifications (customer confirmation + admin alert).
// Reuses the existing Resend-based mailer (config/mailer.js) that already powers
// the Contact Us feature, instead of creating a second/separate email connection.

const { sendNotification } = require('../config/mailer')

// Small helper to format numbers as Malaysian Ringgit consistently everywhere.
const money = (n) => `RM ${Number(n).toFixed(2)}`

// Builds the <tr> rows for the items table inside the email.
// Reuses the same order.items structure you already store in MongoDB.
function orderRows(order) {
  return order.items
    .map((i) => {
      // If the item has a variant (e.g. "500g pack"), show it next to the name.
      const name = i.packSize ? `${i.name} — ${i.packSize}` : i.name
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${name}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(i.price * i.quantity)}</td>
      </tr>`
    })
    .join('')
}

// Formats the shipping address block used in both customer and admin emails.
function addressBlock(a) {
  return [a.fullName, a.phone, a.addressLine1, a.addressLine2, `${a.postcode} ${a.city}`, a.state]
    .filter(Boolean) // removes empty addressLine2 if not provided
    .join('<br>')
}

// Builds the full HTML email body.
// forAdmin=true changes the heading/wording slightly (internal alert vs customer-facing).
function buildHtml(order, { forAdmin = false } = {}) {
  const id = String(order._id)
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#222">
    <h2 style="margin-bottom:4px">${forAdmin ? 'New paid order' : 'Thank you for your order'}</h2>
    <p style="color:#666;margin-top:0">Order ID: ${id}</p>

    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#f6f6f6">
          <th style="padding:8px;text-align:left">Item</th>
          <th style="padding:8px;text-align:center">Qty</th>
          <th style="padding:8px;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${orderRows(order)}</tbody>
    </table>

    <p style="text-align:right;font-size:16px"><strong>Total paid: ${money(order.totalAmount)}</strong></p>

    <h3 style="margin-bottom:4px">Delivery address</h3>
    <p style="margin-top:0;line-height:1.6">${addressBlock(order.shippingAddress)}</p>

    ${forAdmin ? '' : '<p style="color:#666">We will notify you once your order ships.</p>'}
  </div>`
}

// Plain-text fallback version, since sendNotification supports both text and html.
function buildText(order, { forAdmin = false } = {}) {
  const lines = order.items.map((i) => {
    const name = i.packSize ? `${i.name} — ${i.packSize}` : i.name
    return `${name} x${i.quantity} — ${money(i.price * i.quantity)}`
  })
  return [
    forAdmin ? 'New paid order' : 'Thank you for your order',
    `Order ID: ${String(order._id)}`,
    '',
    ...lines,
    '',
    `Total paid: ${money(order.totalAmount)}`,
  ].join('\n')
}

// Main function called from the orders route after a successful PayPal capture.
// Sends:
//   1. A confirmation email to the customer (if we have their email)
//   2. An alert email to the admin/business owner (CONTACT_RECIPIENT, same as Contact Us)
//
// IMPORTANT: this function must NEVER throw in a way that breaks the payment
// response. Any failure here should only be logged, not surfaced to the buyer.
async function sendOrderPaidEmails(order, customerEmail) {
  const jobs = []

  if (customerEmail) {
    jobs.push(
      sendNotification({
        to: customerEmail,
        subject: `Order confirmed — ${String(order._id)}`,
        text: buildText(order),
        html: buildHtml(order),
      }),
    )
  }

  // No `to` passed here on purpose — sendNotification already defaults to
  // process.env.CONTACT_RECIPIENT (same admin inbox used by Contact Us).
  jobs.push(
    sendNotification({
      subject: `New order ${money(order.totalAmount)} — ${order.shippingAddress.fullName}`,
      text: buildText(order, { forAdmin: true }),
      html: buildHtml(order, { forAdmin: true }),
    }),
  )

  // Promise.allSettled (not Promise.all) so that if ONE email fails
  // (e.g. bad customer email address), the other one still sends.
  const results = await Promise.allSettled(jobs)
  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => console.error('Order email failed:', r.reason?.message))
}

module.exports = { sendOrderPaidEmails }