const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = 'unit-test-only-secret'

const userModulePath = require.resolve('../models/User')
const middlewarePath = require.resolve('../middleware/authMiddleware')
const userModel = { findById: () => null }
require.cache[userModulePath] = {
  id: userModulePath,
  filename: userModulePath,
  loaded: true,
  exports: userModel,
}

function loadMiddleware(adminEmails) {
  if (adminEmails === undefined) delete process.env.ADMIN_EMAILS
  else process.env.ADMIN_EMAILS = adminEmails
  delete require.cache[middlewarePath]
  return require(middlewarePath)
}

function responseMock() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('blank admin allowlist leaves existing database admins enabled', async () => {
  const { adminOnly } = loadMiddleware(' , ')
  userModel.findById = async () => ({ email: 'admin@example.com', isAdmin: true })
  const req = { userId: 'user-1' }
  const res = responseMock()
  let nextCalled = false

  await adminOnly(req, res, () => { nextCalled = true })

  assert.equal(nextCalled, true)
  assert.equal(res.statusCode, 200)
})

test('configured admin allowlist matches email case-insensitively', async () => {
  const { adminOnly } = loadMiddleware('owner@example.com, ADMIN@example.com')
  userModel.findById = async () => ({ email: 'Admin@Example.com', isAdmin: true })
  const res = responseMock()
  let nextCalled = false

  await adminOnly({ userId: 'user-1' }, res, () => { nextCalled = true })

  assert.equal(nextCalled, true)
})

test('configured admin allowlist rejects admins whose email is not listed', async () => {
  const { adminOnly } = loadMiddleware('owner@example.com')
  userModel.findById = async () => ({ email: 'admin@example.com', isAdmin: true })
  const res = responseMock()

  await adminOnly({ userId: 'user-1' }, res, () => assert.fail('next must not be called'))

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.message, 'Admin access required')
})

test('cookie-authenticated writes reject missing and untrusted origins', async () => {
  const { protect } = loadMiddleware('')
  const token = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET)

  for (const origin of [undefined, 'https://attacker.example']) {
    const res = responseMock()
    const req = {
      method: 'POST',
      headers: { cookie: `ayusydah_session=${token}` },
      get: () => origin,
    }
    await protect(req, res, () => assert.fail('untrusted request must not continue'))
    assert.equal(res.statusCode, 403)
  }
})

test('deleted session user receives the standard AUTH_REQUIRED response', async () => {
  const { protect } = loadMiddleware('')
  const token = jwt.sign({ id: 'deleted-user' }, process.env.JWT_SECRET)
  userModel.findById = () => ({ select: () => ({ lean: async () => null }) })
  const res = responseMock()
  const req = {
    method: 'GET',
    headers: { cookie: `ayusydah_session=${token}` },
    get: () => undefined,
  }

  await protect(req, res, () => assert.fail('deleted user must not continue'))

  assert.equal(res.statusCode, 401)
  assert.equal(res.body.code, 'AUTH_REQUIRED')
})
