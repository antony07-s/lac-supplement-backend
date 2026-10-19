const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { once } = require('node:events')
const mailer = require('../config/mailer')
const Message = require('../models/Message')

const envKeys = ['RESEND_API_KEY', 'EMAIL_FROM', 'CONTACT_RECIPIENT']

async function withEmailConfig(config, run) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  for (const key of envKeys) {
    if (config[key] === undefined) delete process.env[key]
    else process.env[key] = config[key]
  }
  try {
    return await run()
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
}

const testConfig = {
  RESEND_API_KEY: 'stub-key',
  EMAIL_FROM: 'AYUSYDAH <no-reply@example.test>',
  CONTACT_RECIPIENT: 'support@example.test',
}

test('sendNotification sends configured recipient and returns accepted Resend response', async () => {
  const originalFetch = global.fetch
  let request
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ id: 'stub-email-id' }), { status: 200 })
  }

  try {
    await withEmailConfig(testConfig, async () => {
      assert.deepEqual(await mailer.sendNotification({ subject: 'Test', text: 'Test body' }), { id: 'stub-email-id' })
    })
  } finally {
    global.fetch = originalFetch
  }

  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.deepEqual(request.body.to, ['support@example.test'])
  assert.equal(request.body.from, testConfig.EMAIL_FROM)
  assert.equal(request.options.signal instanceof AbortSignal, true)
})

test('sendNotification logs safe status and error name for a Resend 403', async () => {
  const originalFetch = global.fetch
  const originalError = console.error
  const logs = []
  global.fetch = async () => new Response(JSON.stringify({ name: 'validation_error', message: 'domain not verified' }), { status: 403 })
  console.error = (...args) => logs.push(args)

  try {
    await withEmailConfig(testConfig, async () => {
      await assert.rejects(mailer.sendNotification({ subject: 'Test', text: 'Test body' }), (error) => (
        error.code === 'EMAIL_DELIVERY_FAILED'
        && error.status === 403
        && error.providerErrorName === 'validation_error'
        && error.message === 'Email delivery failed'
      ))
    })
  } finally {
    global.fetch = originalFetch
    console.error = originalError
  }

  assert.deepEqual(logs, [['Resend email request failed:', { status: 403, name: 'validation_error' }]])
  assert.equal(JSON.stringify(logs).includes('stub-key'), false)
  assert.equal(JSON.stringify(logs).includes('domain not verified'), false)
})

test('sendNotification rejects missing API key without making a request', async () => {
  const originalFetch = global.fetch
  let called = false
  global.fetch = async () => { called = true; throw new Error('Unexpected request') }

  try {
    await withEmailConfig({ EMAIL_FROM: testConfig.EMAIL_FROM, CONTACT_RECIPIENT: testConfig.CONTACT_RECIPIENT }, async () => {
      await assert.rejects(mailer.sendNotification({ subject: 'Test', text: 'Test body' }), (error) => error.code === 'EMAIL_NOT_CONFIGURED')
    })
  } finally {
    global.fetch = originalFetch
  }

  assert.equal(called, false)
})

async function runContactRequest(t, notificationBehavior) {
  const originalSend = mailer.sendNotification
  const originalExists = Message.exists
  const originalCreate = Message.create
  const routePath = require.resolve('../routes/contact')
  const sent = []
  let saved = false
  mailer.isContactEmailConfigured = true
  mailer.sendNotification = async (message) => {
    sent.push(message)
    return notificationBehavior(message)
  }
  Message.exists = async () => false
  Message.create = async (message) => { saved = true; return { _id: 'stub-message-id', ...message } }
  delete require.cache[routePath]

  const app = express()
  app.use(express.json())
  app.use('/api/contact', require('../routes/contact'))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.close()
    mailer.sendNotification = originalSend
    mailer.isContactEmailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM?.trim() && process.env.CONTACT_RECIPIENT?.trim())
    Message.exists = originalExists
    Message.create = originalCreate
    delete require.cache[routePath]
  })

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Buyer', email: 'buyer@example.test', subject: 'Question', message: 'Test enquiry' }),
  })
  return { response, body: await response.json(), saved, sent }
}

test('contact route reports saved enquiry and notification failure without provider details', async (t) => {
  const originalError = console.error
  console.error = () => {}
  t.after(() => { console.error = originalError })

  const result = await runContactRequest(t, async () => { throw new Error('Email delivery failed') })
  assert.equal(result.saved, true)
  assert.equal(result.response.status, 502)
  assert.match(result.body.message, /saved, but we could not notify our team/)
  assert.equal(result.body.message.includes('403'), false)
  assert.equal(result.sent.length, 1)
})

test('contact route confirms team notification only after the mailer accepts it', async (t) => {
  const result = await runContactRequest(t, async () => ({ id: 'stub-email-id' }))
  assert.equal(result.response.status, 201)
  assert.equal(result.body.message, 'Your enquiry was received and our team was notified.')
  assert.equal(result.sent.length, 2)
  assert.equal(result.sent[0].to, undefined)
  assert.equal(result.sent[1].to, 'buyer@example.test')
})
