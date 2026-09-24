const { sendNotification } = require('../config/mailer')

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const money = (value) => {
  const amount = Number(value)
  return `RM ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`
}

function orderRows(order) {
  return (order.items || [])
    .map((item) => {
      const name = item.packSize ? `${item.name} — ${item.packSize}` : item.name
      return `<tr>
        <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;color:#182235;font-size:14px;line-height:20px;">${escapeHtml(name)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;text-align:center;color:#5c6677;font-size:14px;">${escapeHtml(item.quantity)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #edf0f5;text-align:right;color:#182235;font-size:14px;font-weight:600;">${escapeHtml(money(Number(item.price) * Number(item.quantity)))}</td>
      </tr>`
    })
    .join('')
}

function addressBlock(address) {
  const a = address || {}
  return [
    a.fullName,
    a.phone,
    a.addressLine1,
    a.addressLine2,
    [a.postcode, a.city].filter(Boolean).join(' '),
    a.state,
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>')
}

function buildHtml(order, { forAdmin = false } = {}) {
  const orderId = escapeHtml(order._id)
  const total = escapeHtml(money(order.totalAmount))
  const heading = forAdmin ? 'New order received' : 'Thank you for your order'
  const intro = forAdmin
    ? 'A customer has completed payment for a new order. Please review and prepare it for fulfilment.'
    : 'We have received your payment and are preparing your order.'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f5f7fb;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(20,37,63,.08);">
        <tr><td style="background:#123f7a;padding:28px 36px;text-align:center;"><span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:.4px;">AYUSYDAH<span style="color:#d7ac54;">.</span></span></td></tr>
        <tr><td style="padding:36px 36px 28px;">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;color:#182235;">${heading}</h1>
          <p style="margin:0;color:#5c6677;font-size:15px;line-height:24px;">${intro}</p>
          ${forAdmin ? '<div style="margin:24px 0 0;background:#fff8e8;border:1px solid #f1d9a5;border-radius:10px;padding:14px 16px;color:#765815;font-size:14px;line-height:21px;"><strong>Internal alert:</strong> This order has been paid and is ready for fulfilment.</div>' : ''}
          <div style="margin:28px 0 20px;background:#f3f6fc;border:1px solid #dce5f4;border-radius:12px;padding:16px 20px;">
            <span style="display:block;color:#5c6677;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.7px;">Order ID</span>
            <span style="display:block;margin-top:4px;color:#123f7a;font-size:15px;line-height:22px;font-weight:700;word-break:break-all;">${orderId}</span>
          </div>
          <h2 style="margin:0 0 10px;font-size:17px;line-height:24px;color:#182235;">Order summary</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;border:1px solid #edf0f5;border-radius:10px;overflow:hidden;">
            <thead><tr style="background:#f3f6fc;"><th style="padding:11px 8px;text-align:left;color:#5c6677;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.4px;">Item</th><th style="padding:11px 8px;text-align:center;color:#5c6677;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.4px;">Qty</th><th style="padding:11px 8px;text-align:right;color:#5c6677;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.4px;">Amount</th></tr></thead>
            <tbody>${orderRows(order)}</tbody>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin-top:18px;"><tr><td style="padding:14px 16px;background:#123f7a;border-radius:10px;color:#ffffff;font-size:16px;line-height:24px;font-weight:700;">Total paid</td><td align="right" style="padding:14px 16px;background:#123f7a;border-radius:10px;color:#ffffff;font-size:18px;line-height:24px;font-weight:700;">${total}</td></tr></table>
          <h2 style="margin:28px 0 8px;font-size:17px;line-height:24px;color:#182235;">Delivery address</h2>
          <div style="background:#f8fafc;border:1px solid #edf0f5;border-radius:10px;padding:16px;color:#5c6677;font-size:14px;line-height:22px;">${addressBlock(order.shippingAddress)}</div>
          ${forAdmin ? '' : '<p style="margin:24px 0 0;color:#5c6677;font-size:14px;line-height:22px;">We will notify you once your order ships.</p>'}
        </td></tr>
        <tr><td style="border-top:1px solid #edf0f5;padding:20px 36px;color:#8791a1;font-size:12px;line-height:18px;text-align:center;">&copy; ${new Date().getFullYear()} AYUSYDAH. All rights reserved.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildText(order, { forAdmin = false } = {}) {
  const lines = (order.items || []).map((item) => {
    const name = item.packSize ? `${item.name} — ${item.packSize}` : item.name
    return `${name} x${item.quantity} — ${money(Number(item.price) * Number(item.quantity))}`
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

function buildShippedHtml(order) {
  const orderId = escapeHtml(order._id)
  const courier = escapeHtml(order.courierName)
  const tracking = escapeHtml(order.trackingNumber)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your order has shipped</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f5f7fb;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(20,37,63,.08);">
        <tr><td style="background:#123f7a;padding:28px 36px;text-align:center;"><span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:.4px;">AYUSYDAH<span style="color:#d7ac54;">.</span></span></td></tr>
        <tr><td style="padding:36px 36px 28px;">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;color:#182235;">Your order is on its way</h1>
          <p style="margin:0;color:#5c6677;font-size:15px;line-height:24px;">Good news — your order has been shipped and is heading to you.</p>
          <div style="margin:28px 0 20px;background:#f3f6fc;border:1px solid #dce5f4;border-radius:12px;padding:16px 20px;">
            <span style="display:block;color:#5c6677;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.7px;">Order ID</span>
            <span style="display:block;margin-top:4px;color:#123f7a;font-size:15px;line-height:22px;font-weight:700;word-break:break-all;">${orderId}</span>
          </div>
          <div style="margin:0 0 20px;background:#eef7f0;border:1px solid #cfe8d4;border-radius:12px;padding:16px 20px;">
            <span style="display:block;color:#2f6e3f;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.7px;">Courier</span>
            <span style="display:block;margin-top:4px;color:#1f4a2a;font-size:15px;line-height:22px;font-weight:700;">${courier}</span>
            <span style="display:block;margin-top:12px;color:#2f6e3f;font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.7px;">Tracking Number</span>
            <span style="display:block;margin-top:4px;color:#1f4a2a;font-size:15px;line-height:22px;font-weight:700;word-break:break-all;">${tracking}</span>
          </div>
          <p style="margin:24px 0 0;color:#5c6677;font-size:14px;line-height:22px;">Please check with the courier directly using the tracking number above for live delivery updates.</p>
        </td></tr>
        <tr><td style="border-top:1px solid #edf0f5;padding:20px 36px;color:#8791a1;font-size:12px;line-height:18px;text-align:center;">&copy; ${new Date().getFullYear()} AYUSYDAH. All rights reserved.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function buildShippedText(order) {
  return [
    'Your order is on its way',
    `Order ID: ${String(order._id)}`,
    '',
    `Courier: ${order.courierName}`,
    `Tracking Number: ${order.trackingNumber}`,
  ].join('\n')
}

async function sendOrderShippedEmail(order, customerEmail) {
  if (!customerEmail) return { ok: false, error: 'Customer email is unavailable' }
  try {
    await sendNotification({
      to: customerEmail,
      subject: `Your order has shipped — ${String(order._id)}`,
      text: buildShippedText(order),
      html: buildShippedHtml(order),
    })
    return { ok: true }
  } catch (err) {
    console.error('Shipped email failed:', err.message)
    return { ok: false, error: err.message }
  }
}

async function sendOrderDeliveredEmail(order, customerEmail) {
  if (!customerEmail) return
  try {
    const orderId = escapeHtml(order._id)
    await sendNotification({
      to: customerEmail,
      subject: `Your order has been delivered — ${String(order._id)}`,
      text: `Your order has been delivered.\n\nOrder ID: ${String(order._id)}\n\nThank you for choosing AYUSYDAH.`,
      html: `<!doctype html><html lang="en"><body style="margin:0;padding:32px 16px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:16px;"><tr><td style="background:#123f7a;padding:28px 36px;text-align:center;color:#fff;font-size:24px;font-weight:700;">AYUSYDAH</td></tr><tr><td style="padding:36px;"><h1 style="margin:0 0 12px;font-size:24px;">Your order has been delivered</h1><p style="color:#5c6677;line-height:24px;">Your order has arrived. Thank you for choosing AYUSYDAH.</p><p style="margin-top:24px;padding:14px 16px;background:#f3f6fc;border-radius:10px;color:#123f7a;font-weight:700;word-break:break-all;">Order ID: ${orderId}</p></td></tr></table></td></tr></table></body></html>`,
    })
  } catch (err) {
    console.error('Delivered email failed:', err.message)
  }
}

async function sendOrderPaidEmails(order, customerEmail) {
  const jobs = []
  if (customerEmail) {
    jobs.push(sendNotification({
      to: customerEmail,
      subject: `Order confirmed — ${String(order._id)}`,
      text: buildText(order),
      html: buildHtml(order),
    }))
  }
  jobs.push(sendNotification({
    subject: `New order ${money(order.totalAmount)} — ${order.shippingAddress.fullName}`,
    text: buildText(order, { forAdmin: true }),
    html: buildHtml(order, { forAdmin: true }),
  }))
  const results = await Promise.allSettled(jobs)
  results
    .filter((result) => result.status === 'rejected')
    .forEach((result) => console.error('Order email failed:', result.reason?.message))
}

module.exports = { sendOrderPaidEmails, sendOrderShippedEmail, sendOrderDeliveredEmail }
