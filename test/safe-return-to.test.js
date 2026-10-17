const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('url')
const path = require('path')

const source = pathToFileURL(path.join(__dirname, '../../lac-supplement-store/src/utils/safeReturnTo.js')).href

test('safeReturnTo keeps same-origin paths and rejects open redirects', async () => {
  global.window = { location: { origin: 'https://www.ayusydah.com' } }
  const { safeReturnTo } = await import(source)

  assert.equal(safeReturnTo('/checkout'), '/checkout')
  assert.equal(safeReturnTo('/orders/abc?payment=success'), '/orders/abc?payment=success')
  assert.equal(safeReturnTo('/product/1#reviews'), '/product/1#reviews')
  assert.equal(safeReturnTo('//evil.example'), '/')
  assert.equal(safeReturnTo('/\\evil.example'), '/')
  assert.equal(safeReturnTo('https://evil.example'), '/')
  assert.equal(safeReturnTo(''), '/')
  assert.equal(safeReturnTo(null), '/')
  assert.equal(safeReturnTo('/checkout@https://evil.example'), '/checkout@https://evil.example')
})
