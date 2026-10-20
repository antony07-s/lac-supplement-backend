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

async function setup(t, {
  providerStatus = 'APPROVED',
  providerAmount = '50.00',
  captureIssue = null,
} = {}) {
  const envKeys = ['PAYPAL_ENV', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'NODE_ENV']
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  const originalFetch = global.fetch
  const originalFindById = Order.findById
  const originalFindOneAndUpdate = Order.findOneAndUpdate
  const originalUpdateOne = Order.updateOne
  const originalUserFindById = User.findById
  const originalProtect = auth.protect
  const originalPaidEmail = notifications.sendOrderPaidEmails
  const originalConsoleError = console.error
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
  const state = { capturePosts: 0, paidEmails: 0, logs: [] }

  process.env.PAYPAL_ENV = 'sandbox'
  process.env.PAYPAL_CLIENT_ID = 'stub-client-id'
  process.env.PAYPAL_CLIENT_SECRET = 'stub-client-secret'
  process.env.NODE_ENV = 'test'
  auth.protect = (req, res, next) => { req.userId = 'buyer-id'; next() }
  notifications.sendOrderPaidEmails = async () => { state.paidEmails += 1 }
  console.error = (...args) => { state.logs.push(args.join(' ')) }
  Order.findById = async () => order
  Order.findOneAndUpdate = async (_filter, update) => {
    if (update.$set?.paymentProcessing === true) order.paymentProcessing = true
    if (update.$set?.status === 'paid') {
      order.status = 'paid'
      order.paypalCaptureId = captureId
      order.paymentProcessing = false
    }
    return order
  }
  Order.updateOne = async (_filter, update) => {
    if (update.$set?.paymentProcessing === false) order.paymentProcessing = false
    return { modifiedCount: 1 }
  }
  User.findById = () => ({ select: () => ({ lean: async () => ({ email: 'buyer@example.test' }) }) })
  delete require.cache[paypalPath]
  delete require.cache[paymentStatePath]
  delete require.cache[routePath]

  global.fetch = async (url, options = {}) => {
    const target = String(url)
    const method = options.method || 'GET'
    if (target.endsWith('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'stub-access-token' }), { status: 200 })
    }
    if (target.endsWith(`/v2/checkout/orders/${paypalOrderId}`)) {
      return new Response(JSON.stringify({
        id: paypalOrderId,
        status: providerStatus,
        purchase_units: providerStatus === 'CREATED' ? [] : [{
          reference_id: orderId,
          amount: { currency_code: 'MYR', value: providerAmount },
          payments: { captures: [] },
        }],
      }), { status: 200 })
    }
    if (target.endsWith(`/v2/checkout/orders/${paypalOrderId}/capture`) && method === 'POST') {
      state.capturePosts += 1
      if (captureIssue) {
        return new Response(JSON.stringify({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: captureIssue }] }), { status: 422 })
      }
      return new Response(JSON.stringify({
        id: paypalOrderId,
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: captureId, status: 'COMPLETED' }] } }],
      }), { status: 201 })
    }
    if (target.endsWith(`/v2/payments/captures/${captureId}`)) {
      return new Response(JSON.stringify({
        id: captureId,
        status: 'COMPLETED',
        amount: { currency_code: 'MYR', value: '50.00' },
        supplementary_data: { related_ids: { order_id: paypalOrderId } },
      }), { status: 200 })
    }
    throw new Error(`Unexpected mocked PayPal request: ${method} ${target}`)
  }

  const app = express()
  app.use(express.json())
  app.use('/api/orders', require('../routes/orderRoutes'))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const address = `http://127.0.0.1:${server.address().port}`

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    global.fetch = originalFetch
    Order.findById = originalFindById
    Order.findOneAndUpdate = originalFindOneAndUpdate
    Order.updateOne = originalUpdateOne
    User.findById = originalUserFindById
    auth.protect = originalProtect
    notifications.sendOrderPaidEmails = originalPaidEmail
    console.error = originalConsoleError
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
    delete require.cache[routePath]
    delete require.cache[paymentStatePath]
    delete require.cache[paypalPath]
  })

  return { address, order, state }
}

test('PayPal ORDER_NOT_APPROVED returns an actionable message and releases the payment lock', async (t) => {
  const { address, order, state } = await setup(t, { captureIssue: 'ORDER_NOT_APPROVED' })
  const result = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })

  assert.equal(result.status, 409)
  assert.match(result.body.message, /finish approval in the PayPal window/i)
  assert.equal(order.status, 'pending')
  assert.equal(order.paymentProcessing, false)
  assert.equal(state.paidEmails, 0)
  assert.equal(state.capturePosts, 1)
  assert.deepEqual(state.logs, ['PayPal capture failed: HTTP 422; issue ORDER_NOT_APPROVED'])
})

for (const [issue, expected] of [
  ['INSTRUMENT_DECLINED', /declined that payment method/i],
  ['PAYER_ACTION_REQUIRED', /complete another step/i],
]) {
  test(`PayPal ${issue} returns a clear customer message`, async (t) => {
    const { address, order, state } = await setup(t, { captureIssue: issue })
    const result = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })

    assert.equal(result.status, 409)
    assert.match(result.body.message, expected)
    assert.equal(order.status, 'pending')
    assert.equal(order.paymentProcessing, false)
    assert.equal(state.paidEmails, 0)
    assert.deepEqual(state.logs, [`PayPal capture failed: HTTP 422; issue ${issue}`])
  })
}

test('PayPal CREATED order is not captured and is not reported as an amount mismatch', async (t) => {
  const { address, order, state } = await setup(t, { providerStatus: 'CREATED' })
  const result = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })

  assert.equal(result.status, 409)
  assert.match(result.body.message, /not approved yet.*finish approval/i)
  assert.doesNotMatch(result.body.message, /amount|currency|reference/i)
  assert.equal(state.capturePosts, 0)
  assert.equal(order.status, 'pending')
  assert.equal(order.paymentProcessing, false)
  assert.equal(state.paidEmails, 0)
})

test('APPROVED PayPal order with a mismatched amount gets a distinct mismatch response', async (t) => {
  const { address, order, state } = await setup(t, { providerAmount: '49.00' })
  const result = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })

  assert.equal(result.status, 409)
  assert.match(result.body.message, /amount, currency, or order reference does not match/i)
  assert.equal(state.capturePosts, 0)
  assert.equal(order.status, 'pending')
  assert.equal(order.paymentProcessing, false)
  assert.equal(state.paidEmails, 0)
})

test('APPROVED PayPal order captures and verifies successfully; duplicate request does not send another paid email', async (t) => {
  const { address, order, state } = await setup(t)
  const first = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(first.status, 200)
  assert.deepEqual(first.body, { status: 'paid', paypal: 'COMPLETED' })
  assert.equal(order.status, 'paid')
  assert.equal(state.paidEmails, 1)
  assert.equal(order.paymentProcessing, false)

  const repeated = await postJson(address, `/api/orders/${orderId}/paypal-capture`, { paypalOrderId })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(repeated.status, 409)
  assert.equal(order.status, 'paid')
  assert.equal(state.capturePosts, 1)
  assert.equal(state.paidEmails, 1)
})
