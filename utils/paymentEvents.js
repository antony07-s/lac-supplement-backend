const PaymentEvent = require('../models/PaymentEvent')

const PROCESSING_LEASE_MS = 5 * 60 * 1000
let indexSetup

async function claimPaymentEvent(provider, eventId, eventType) {
  if (!eventId || String(eventId).length > 200) throw new Error('A provider event ID is required')
  if (!indexSetup) indexSetup = PaymentEvent.init()
  try { await indexSetup } catch (error) { indexSetup = null; throw error }
  try {
    const event = await PaymentEvent.create({ provider, eventId: String(eventId), eventType: String(eventType || 'unknown') })
    return { event, claimed: true, duplicate: false }
  } catch (error) {
    if (error.code !== 11000) throw error
  }

  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS)
  const event = await PaymentEvent.findOneAndUpdate(
    { provider, eventId: String(eventId), $or: [{ status: 'failed' }, { status: 'processing', updatedAt: { $lte: staleBefore } }] },
    { $set: { status: 'processing', eventType: String(eventType || 'unknown'), lastError: '' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  )
  if (event) return { event, claimed: true, duplicate: false }
  return { event: await PaymentEvent.findOne({ provider, eventId: String(eventId) }), claimed: false, duplicate: true }
}

async function completePaymentEvent(event) {
  await PaymentEvent.updateOne({ _id: event._id, status: 'processing' }, { $set: { status: 'processed', processedAt: new Date(), lastError: '' } })
}

async function failPaymentEvent(event, error) {
  await PaymentEvent.updateOne({ _id: event._id, status: 'processing' }, { $set: { status: 'failed', lastError: String(error?.message || error || 'Unknown error').slice(0, 500) } })
}

module.exports = { claimPaymentEvent, completePaymentEvent, failPaymentEvent }
