const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateCheckout, moneyToSen, senToMoney } = require('../utils/checkout')

const item = (overrides = {}) => ({ price: 50, quantity: 2, weightKg: 0.5, ...overrides })

function withEnv(vars, fn) {
  const previous = {}
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    return fn()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

const malaysiaRates = {
  WEST_MALAYSIA_SHIPPING_RATE_PER_KG: '10',
  EAST_MALAYSIA_SHIPPING_RATE_PER_KG: '20',
  DISCOUNT_ABOVE_1000: '50',
  DISCOUNT_ABOVE_1000_TYPE: 'amount',
  DISCOUNT_ABOVE_1000_THRESHOLD: '1000',
}

test('money conversion rejects negatives and non-numbers', () => {
  assert.equal(moneyToSen(12.345), 1235)
  assert.equal(senToMoney(1235), 12.35)
  assert.throws(() => moneyToSen(-1), /Invalid monetary value/)
  assert.throws(() => moneyToSen(Number.NaN), /Invalid monetary value/)
})

test('west Malaysia checkout uses west rate and no discount below threshold', () => {
  withEnv(malaysiaRates, () => {
    const result = calculateCheckout({ items: [item()], state: 'Selangor' })
    assert.equal(result.shippingRegion, 'west-malaysia')
    assert.equal(result.subtotal, 100)
    assert.equal(result.discount, 0)
    assert.equal(result.shipping, 10)
    assert.equal(result.totalAmount, 110)
    assert.equal(result.totalWeightKg, 1)
  })
})

test('east Malaysia states use the east shipping rate', () => {
  withEnv(malaysiaRates, () => {
    for (const state of ['Sabah', 'Sarawak', 'Labuan']) {
      const result = calculateCheckout({ items: [item()], state })
      assert.equal(result.shippingRegion, 'east-malaysia')
      assert.equal(result.shipping, 20)
      assert.equal(result.totalAmount, 120)
    }
  })
})

test('amount discount applies at the configured threshold', () => {
  withEnv({ ...malaysiaRates, DISCOUNT_ABOVE_1000_THRESHOLD: '100' }, () => {
    const result = calculateCheckout({ items: [item({ price: 80, quantity: 2 })], state: 'Penang' })
    assert.equal(result.subtotal, 160)
    assert.equal(result.discount, 50)
    assert.equal(result.totalAmount, 120)
  })
})

test('percent discount is capped at the subtotal', () => {
  withEnv({
    ...malaysiaRates,
    DISCOUNT_ABOVE_1000_THRESHOLD: '10',
    DISCOUNT_ABOVE_1000_TYPE: 'percent',
    DISCOUNT_ABOVE_1000: '25',
  }, () => {
    const result = calculateCheckout({ items: [item({ price: 100, quantity: 1, weightKg: 1 })], state: 'Johor' })
    assert.equal(result.discount, 25)
    assert.equal(result.shipping, 10)
    assert.equal(result.totalAmount, 85)
  })
})

test('missing shipping rate fails closed', () => {
  withEnv({ ...malaysiaRates, WEST_MALAYSIA_SHIPPING_RATE_PER_KG: undefined }, () => {
    assert.throws(
      () => calculateCheckout({ items: [item()], state: 'Selangor' }),
      (error) => error.status === 503,
    )
  })
})

test('invalid product weight cannot be checked out', () => {
  withEnv(malaysiaRates, () => {
    assert.throws(
      () => calculateCheckout({ items: [item({ weightKg: 0 })], state: 'Selangor' }),
      (error) => error.status === 409,
    )
  })
})

test('India shipping is rejected until enabled and fully configured', () => {
  withEnv({ ...malaysiaRates, INDIA_SHIPPING_ENABLED: 'false' }, () => {
    assert.throws(
      () => calculateCheckout({ items: [item()], state: 'Kerala', country: 'India' }),
      (error) => error.status === 503 && /India shipping/.test(error.message),
    )
  })
})

test('India checkout uses India rate and discount when configured', () => {
  withEnv({
    ...malaysiaRates,
    INDIA_SHIPPING_ENABLED: 'true',
    INDIA_SHIPPING_RATE_PER_KG: '15',
    INDIA_DISCOUNT_ABOVE_1000_THRESHOLD: '100',
    INDIA_DISCOUNT_ABOVE_1000_TYPE: 'amount',
    INDIA_DISCOUNT_ABOVE_1000: '20',
  }, () => {
    const result = calculateCheckout({ items: [item({ price: 80, quantity: 2 })], state: 'Kerala', country: 'India' })
    assert.equal(result.shippingRegion, 'india')
    assert.equal(result.subtotal, 160)
    assert.equal(result.discount, 20)
    assert.equal(result.shipping, 15)
    assert.equal(result.totalAmount, 155)
  })
})
