const PAYPAL_BASE = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

async function getPayPalAccessToken() {
  if (process.env.NODE_ENV === 'production' && process.env.PAYPAL_ENV !== 'live') {
    throw new Error('PayPal must use PAYPAL_ENV=live in production')
  }
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal credentials are not configured')
  }
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
  console.error('PayPal token request failed:', res.status)
  throw new Error('Failed to get PayPal access token')
}

  const data = await res.json()
  return data.access_token
}

module.exports = { PAYPAL_BASE, getPayPalAccessToken }
