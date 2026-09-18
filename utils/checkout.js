const EAST_MALAYSIA_STATES = new Set(['Sabah', 'Sarawak', 'Labuan'])
const SEN_PER_RINGGIT = 100

function moneyToSen(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid monetary value')
  return Math.round((number + Number.EPSILON) * SEN_PER_RINGGIT)
}

function senToMoney(sen) {
  return Number((sen / SEN_PER_RINGGIT).toFixed(2))
}

function configuredNumber(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw Object.assign(new Error(`${name} must be configured before checkout can be used`), { status: 503 })
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error(`${name} must be a non-negative number`), { status: 503 })
  return number
}

function calculateDiscount(subtotalSen) {
  const thresholdSen = moneyToSen(process.env.DISCOUNT_ABOVE_1000_THRESHOLD || 1000)
  if (subtotalSen < thresholdSen) return 0
  const type = (process.env.DISCOUNT_ABOVE_1000_TYPE || 'amount').toLowerCase()
  const value = configuredNumber('DISCOUNT_ABOVE_1000')
  if (type === 'percent' || type === 'percentage') return Math.min(subtotalSen, Math.round(subtotalSen * value / 100))
  if (type !== 'amount') throw Object.assign(new Error('DISCOUNT_ABOVE_1000_TYPE must be amount or percent'), { status: 503 })
  return Math.min(subtotalSen, moneyToSen(value))
}

function calculateCheckout({ items, state }) {
  const subtotalSen = items.reduce((total, item) => total + moneyToSen(item.price) * item.quantity, 0)
  const totalWeightKg = items.reduce((total, item) => total + Number(item.weightKg) * item.quantity, 0)
  if (!Number.isFinite(totalWeightKg) || totalWeightKg <= 0) {
    throw Object.assign(new Error('Every product needs a valid shipping weight before it can be checked out'), { status: 409 })
  }
  const shippingRegion = EAST_MALAYSIA_STATES.has(state) ? 'east-malaysia' : 'west-malaysia'
  const rate = configuredNumber(shippingRegion === 'east-malaysia' ? 'EAST_MALAYSIA_SHIPPING_RATE_PER_KG' : 'WEST_MALAYSIA_SHIPPING_RATE_PER_KG')
  const discountSen = calculateDiscount(subtotalSen)
  const shippingSen = moneyToSen(totalWeightKg * rate)
  const totalSen = subtotalSen - discountSen + shippingSen
  return {
    subtotal: senToMoney(subtotalSen), discount: senToMoney(discountSen), shipping: senToMoney(shippingSen),
    totalAmount: senToMoney(totalSen), totalWeightKg: Number(totalWeightKg.toFixed(3)), shippingRegion,
  }
}

module.exports = { calculateCheckout, moneyToSen, senToMoney }
