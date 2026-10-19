const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const Order = require('../models/Order')
const User = require('../models/User')
const auth = require('../middleware/authMiddleware')
const notifications = require('../utils/notify')

const orderId = '507f1f77bcf86cd799439011'
const paypalOrderId = 'PAYPALORDER12345'
const captureId = 'CAPTURE123456789'

function postJson(url, path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { data += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }))
    })
    request.on('error', reject)
    request.end(JSON.stringify(body))
  })
}

test('PayPal capture retry verifies an already completed capture without capturing twice', async (t) => {
  const envKeys = ['PAYPAL_ENV', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'NODE_ENV']
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  const originalFetch = global.fetch
  const originalFindById = Order.findById
  const originalFindOneAndUpdate = Order.findOneAndUpdate
  const originalUserFindById = User.findById
  const originalProtect = auth.protect
  const originalPaidEmail = notifications.sendOrderPaidEmails
  const paypalPath = require.resolve('../utils/paypal')
  const routePath = require.resolve('../routes/orderRoutes')
  const paymentStatePath = require.resolve('../utils/providerPayments')
  const order = {
    _id: orderId,
    user: 'buyer-id',
    status: 'pending',
    stockReserved: true,
    paymentProcessing: false,
    paymentProvider: 'paypal',
    paypalOrderId,
    totalAmount: 50,
    paypalCaptureId: null,
  }
  const calls = []
  let capturePostCount = 0

  process.env.PAYPAL_ENV = 'sandbox'
  process.env.PAYPAL_CLIENT_ID = 'stub-client-id'
  process.env.PAYPAL_CLIENT_SECRET = 'stub-client-secret'
  process.env.NODE_ENV = 'test'
  auth.protect = (req, res, next) => { req.userId = 'buyer-id'; next() }
  notifications.sendOrderPaidEmails = async () => {}
  Order.findById = async () => order
  Order.findOneAndUpdate = async (_filter, update) => {
    calls.push(update)
    if (update.$set?.status === 'paid') {
      order.status = 'paid'
      order.paypalCaptureId = captureId
    }
    return order
  }
  User.findById = () => ({ select: () => ({ lean: async () => ({ email: 'buyer@example.test' }) }) })
  delete require.cache[paypalPath]
  delete require.cache[paymentStatePath]
  delete require.cache[routePath]

  const app = express()
  app.use(express.json())
  app.use('/api/orders', require('../routes/orderRoutes'))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = `http://127.0.0.1:${server.address().port}`

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' })
    if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'stub-access-token' }), { status: 200 })
    if (String(url).endsWith(`/v2/checkout/orders/${paypalOrderId}`)) {
      return new Response(JSON.stringify({
        id: paypalOrderId,
        status: 'COMPLETED',
        purchase_units: [{
          reference_id: orderId,
          amount: { currency_code: 'MYR', value: '50.00' },
          payments: { captures: [{ id: captureId, status: 'COMPLETED' }] },
        }],
      }), { status: 200 })
    }
    if (String(url).endsWith(`/v2/payments/captures/${captureId}`)) {
      return new Response(JSON.stringify({
        id: captureId,
        status: 'COMPLETED',
        amount: { currency_code: 'MYR', value: '50.00' },
        supplementary_data: { related_ids: { order_id: paypalOrderId } },
      }), { status: 200 })
    }
    if (String(url).endsWith(`/v2/checkout/orders/${paypalOrderId}/capture`)) capturePostCount += 1
    throw new Error('Unexpected mocked PayPal request')
  }

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    global.fetch = originalFetch
    Order.findById = originalFindById
    Order.findOneAndUpdate = originalFindOneAndUpdate
    User.findById = originalUserFindById
    auth.protect = originalProtect
    notifications.sendOrderPaidEmails = originalPaidEmail
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
    delete require.cache[routePath]
    delete require.cache[paymentStatePath]
    delete require.cache[paypalPath]
  })

  const result = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { status: 'paid', paypal: 'COMPLETED' })
  assert.equal(order.status, 'paid')
  assert.equal(capturePostCount, 0)
  assert.equal(calls.some((call) => call.$set?.status === 'paid'), true)
})
