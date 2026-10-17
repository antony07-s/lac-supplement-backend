const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const cartModelPath = require.resolve('../models/Cart')
const wishlistModelPath = require.resolve('../models/Wishlist')
const productModelPath = require.resolve('../models/Product')
const authMiddlewarePath = require.resolve('../middleware/authMiddleware')

const productId = '64b000000000000000000001'
const variantId = '64b000000000000000000002'
let cartUpdate
let wishlistUpdate
let queriedProducts
let cartDocument
let wishlistDocument

const Cart = {
  findOne: () => ({ populate: async () => cartDocument }),
  findOneAndUpdate: (filter, update, options) => {
    cartUpdate = { filter, update, options }
    return { populate: async () => cartDocument }
  },
}
const Wishlist = {
  findOne: () => ({ populate: () => ({ populate: async () => wishlistDocument }) }),
  findOneAndUpdate: (filter, update, options) => {
    wishlistUpdate = { filter, update, options }
    return { populate: async () => wishlistDocument }
  },
}
const Product = {
  find: (filter) => {
    queriedProducts = filter
    return { select: async () => [makeProduct()] }
  },
}

function makeProduct() {
  const variant = { _id: variantId, price: 24, originalPrice: 30, image: '/variant.jpg', stock: 6, isAvailable: true, packSize: '60 capsules', sku: 'CAP-60' }
  const variants = [variant]
  variants.id = (id) => variants.find((item) => String(item._id) === String(id))
  return {
    _id: productId,
    name: 'Test Supplement',
    image: '/product.jpg',
    price: 20,
    originalPrice: 25,
    stock: 10,
    variants,
    toObject() { return { _id: productId, name: this.name, image: this.image, price: this.price, originalPrice: this.originalPrice, stock: this.stock, variants: [variant] } },
  }
}

function populateDocuments() {
  const product = makeProduct()
  cartDocument = { items: [{ product, variant: variantId, quantity: 2 }] }
  wishlistDocument = { items: [{ product, variant: variantId }] }
}

function mockModule(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

mockModule(cartModelPath, Cart)
mockModule(wishlistModelPath, Wishlist)
mockModule(productModelPath, Product)
mockModule(authMiddlewarePath, { protect(req, res, next) { req.userId = 'user-1'; next() } })

const app = express()
app.use(express.json())
app.use('/cart', require('../routes/cartRoutes'))
app.use('/wishlist', require('../routes/wishlistRoutes'))
let server
let baseUrl

test.before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.beforeEach(() => {
  cartUpdate = null
  wishlistUpdate = null
  queriedProducts = null
  populateDocuments()
})

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  for (const filename of [cartModelPath, wishlistModelPath, productModelPath, authMiddlewarePath]) delete require.cache[filename]
  delete require.cache[require.resolve('../routes/cartRoutes')]
  delete require.cache[require.resolve('../routes/wishlistRoutes')]
})

test('cart PUT rejects a non-array items payload without querying products', async () => {
  const response = await fetch(`${baseUrl}/cart`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: {} }) })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'items must be an array' })
  assert.equal(queriedProducts, null)
})

test('cart PUT validates quantities, saves valid lines, and returns hydrated variants', async () => {
  const response = await fetch(`${baseUrl}/cart`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [
      { productId, variantId, quantity: 2 },
      { productId, quantity: 0 },
      { productId: 'bad-id', quantity: 1 },
    ] }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(cartUpdate.filter, { user: 'user-1' })
  assert.deepEqual(cartUpdate.update.items, [{ product: productId, variant: variantId, quantity: 2 }])
  const [line] = await response.json()
  assert.equal(line.quantity, 2)
  assert.equal(line.price, 24)
  assert.equal(line.packSize, '60 capsules')
  assert.equal(line.image, '/variant.jpg')
})

test('wishlist PUT rejects a non-array items payload', async () => {
  const response = await fetch(`${baseUrl}/wishlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: null }) })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'items must be an array' })
  assert.equal(wishlistUpdate, null)
})

test('wishlist PUT stores valid product variants and serializes the populated response', async () => {
  const response = await fetch(`${baseUrl}/wishlist`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [
      { productId, variantId },
      { productId: 'bad-id' },
      { productId, variantId: 'bad-variant' },
    ] }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(wishlistUpdate.filter, { user: 'user-1' })
  assert.deepEqual(wishlistUpdate.update.items, [{ product: productId, variant: variantId }])
  const [line] = await response.json()
  assert.equal(line.variantId, variantId)
  assert.equal(line.price, 24)
  assert.equal(line.packSize, '60 capsules')
})
