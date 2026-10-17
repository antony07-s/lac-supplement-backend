const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const orderModulePath = require.resolve('../models/Order')
const inventoryModulePath = require.resolve('../utils/orderInventory')
const refundsModulePath = require.resolve('../utils/refunds')

let findOneAndUpdate
let findById
let restoreOrderItems
let restoreCalls
let session

const fakeOrderModel = {
  findOneAndUpdate: (...args) => findOneAndUpdate(...args),
  findById: (...args) => findById(...args),
}

require.cache[orderModulePath] = {
  id: orderModulePath,
  filename: orderModulePath,
  loaded: true,
  exports: fakeOrderModel,
}
require.cache[inventoryModulePath] = {
  id: inventoryModulePath,
  filename: inventoryModulePath,
  loaded: true,
  exports: { restoreOrderItems: (...args) => restoreOrderItems(...args) },
}

const originalStartSession = mongoose.startSession
mongoose.startSession = async () => session
const { finishRefund } = require('../utils/refunds')

function makeSession() {
  return {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  }
}

function makeOrder(overrides = {}) {
  return {
    _id: 'order-1',
    status: 'paid',
    stockReserved: true,
    refundStatus: 'processing',
    refundRequestId: 'request-1',
    items: [],
    save: async function save() { return this },
    ...overrides,
  }
}

test.beforeEach(() => {
  session = makeSession()
  restoreCalls = 0
  restoreOrderItems = async () => { restoreCalls += 1 }
})

test.after(() => {
  mongoose.startSession = originalStartSession
  delete require.cache[refundsModulePath]
})

test('completed refund atomically claims paid reserved stock before restoring it', async () => {
  const order = makeOrder()
  let filterSeen
  findOneAndUpdate = async (filter, update, options) => {
    filterSeen = filter
    assert.equal(update.$set.status, 'refunded')
    assert.equal(update.$set.stockReserved, false)
    assert.equal(options.session, session)
    return { ...order, status: 'refunded', stockReserved: false }
  }
  findById = () => assert.fail('fallback lookup is not needed after a successful claim')

  const result = await finishRefund(order, 'refund-1', 'completed')

  assert.equal(result.status, 'refunded')
  assert.equal(filterSeen.status, 'paid')
  assert.equal(filterSeen.stockReserved, true)
  assert.equal(filterSeen.refundRequestId, 'request-1')
  assert.equal(restoreCalls, 1)
})

test('duplicate completed refund does not restore inventory twice', async () => {
  const order = makeOrder()
  const alreadyRefunded = makeOrder({ status: 'refunded', stockReserved: false, refundStatus: 'completed' })
  findOneAndUpdate = async () => null
  findById = () => ({ session: async () => alreadyRefunded })

  const result = await finishRefund(order, 'refund-1', 'completed')

  assert.equal(result, alreadyRefunded)
  assert.equal(restoreCalls, 0)
})

test('shipped order refund completes without restoring stock', async () => {
  const order = makeOrder()
  const shipped = makeOrder({ status: 'shipped', stockReserved: false })
  findOneAndUpdate = async (filter) => {
    assert.equal(filter.status, 'paid')
    assert.equal(filter.stockReserved, true)
    return null
  }
  findById = () => ({ session: async () => shipped })

  const result = await finishRefund(order, 'refund-1', 'completed')

  assert.equal(result.status, 'refunded')
  assert.equal(restoreCalls, 0)
  assert.equal(shipped.stockReserved, false)
})

test('stale refund request cannot complete a different refund request', async () => {
  const order = makeOrder()
  const changedRequest = makeOrder({ refundRequestId: 'request-2' })
  findOneAndUpdate = async () => null
  findById = () => ({ session: async () => changedRequest })

  await assert.rejects(() => finishRefund(order, 'refund-1', 'completed'), {
    status: 409,
    message: 'Refund request changed; reload the order before continuing.',
  })
  assert.equal(restoreCalls, 0)
})
