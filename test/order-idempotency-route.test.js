const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const orderModelPath = require.resolve('../models/Order')
const productModelPath = require.resolve('../models/Product')
const userModelPath = require.resolve('../models/User')
const authMiddlewarePath = require.resolve('../middleware/authMiddleware')

let existingOrder
let forcedTransactionError
let findOneCalls
let endedSession
const Order = {
  startSession: async () => ({
    withTransaction: async (callback) => {
      if (forcedTransactionError) throw forcedTransactionError
      return callback()
    },
    endSession: async () => { endedSession = true },
  }),
  findOne: () => {
    const result = {
      session: async () => {
        findOneCalls += 1
        return existingOrder
      },
      then: (resolve, reject) => Promise.resolve(existingOrder).then(resolve, reject),
    }
    return result
  },
}

function mockModule(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

mockModule(orderModelPath, Order)
mockModule(productModelPath, { find: () => assert.fail('duplicate order must not load products') })
mockModule(userModelPath, {})
mockModule(authMiddlewarePath, { protect(req, res, next) { req.userId = 'buyer-2'; next() }, adminOnly(req, res, next) { next() } })

const app = express()
app.use(express.json())
app.use('/orders', require('../routes/orderRoutes'))
let server
let baseUrl

test.before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.beforeEach(() => {
  existingOrder = null
  forcedTransactionError = null
  findOneCalls = 0
  endedSession = false
})

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  for (const filename of [orderModelPath, productModelPath, userModelPath, authMiddlewarePath]) delete require.cache[filename]
  delete require.cache[require.resolve('../routes/orderRoutes')]
})

const validShippingAddress = {
  fullName: 'Buyer Two',
  phone: '+60123456789',
  addressLine1: '10 Test Street',
  city: 'Kuala Lumpur',
  state: 'Selangor',
  postcode: '50000',
}

test('order creation requires an idempotency key', async () => {
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shippingAddress: validShippingAddress }),
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'A valid Idempotency-Key is required' })
  assert.equal(endedSession, false)
})

test('same-owner idempotent retry returns the existing order', async () => {
  existingOrder = { _id: 'order-1', user: 'buyer-2', shippingAddress: validShippingAddress, totalAmount: 100 }
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'retry-1' },
    body: JSON.stringify({ shippingAddress: validShippingAddress }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), existingOrder)
  assert.equal(endedSession, true)
})

test('another buyer idempotency collision returns 409 without order details', async () => {
  existingOrder = {
    _id: 'private-order',
    user: 'buyer-1',
    shippingAddress: { fullName: 'Private buyer', addressLine1: 'Private address' },
    totalAmount: 9876,
  }
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'stolen-key' },
    body: JSON.stringify({ shippingAddress: validShippingAddress }),
  })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.deepEqual(body, { message: 'This checkout request conflicts with an existing order' })
  assert.equal(JSON.stringify(body).includes('private-order'), false)
  assert.equal(JSON.stringify(body).includes('Private address'), false)
  assert.equal(endedSession, true)
})

test('duplicate-key race handler also rejects a different owner', async () => {
  existingOrder = { _id: 'private-order', user: 'buyer-1', totalAmount: 9876 }
  forcedTransactionError = Object.assign(new Error('duplicate key'), { code: 11000 })
  const response = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'racing-key' },
    body: JSON.stringify({ shippingAddress: validShippingAddress }),
  })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.deepEqual(body, { message: 'This checkout request conflicts with an existing order' })
  assert.equal(JSON.stringify(body).includes('private-order'), false)
  assert.equal(endedSession, true)
})
