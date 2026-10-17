const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateCapture, canCancelOrder } = require('../utils/paymentState')
const { classifyRazorpayPayments, classifyPayPalOrderStatus, classifyPayPalOrder, getProviderPaymentState } = require('../utils/providerPayments')

const pendingOrder = () => ({ _id: 'order-local', status: 'pending', stockReserved: true, razorpayPaymentId: null, paypalCaptureId: null })
const capturedRazorpay = () => ({ id: 'pay_local', status: 'captured', currency: 'MYR', amount: 12500 })
const evaluateRazorpay = (order, payment = capturedRazorpay()) => evaluateCapture({
  order, payment, providerOrderId: 'rzp-order-local', paymentOrderId: 'rzp-order-local', currency: 'MYR', expectedAmount: 12500,
})

test('captured, exact provider payment settles a reserved pending order', () => {
  assert.equal(evaluateRazorpay(pendingOrder()), 'settle')
})

test('failed or merely authorized payment cannot settle', () => {
  assert.equal(evaluateRazorpay(pendingOrder(), { ...capturedRazorpay(), status: 'failed' }), 'not-captured')
  assert.equal(evaluateRazorpay(pendingOrder(), { ...capturedRazorpay(), status: 'authorized' }), 'not-captured')
})

test('captured payment for a cancelled or unreserved order is reconciled as late', () => {
  assert.equal(evaluateRazorpay({ ...pendingOrder(), status: 'cancelled', stockReserved: false }), 'late-capture')
  assert.equal(evaluateRazorpay({ ...pendingOrder(), stockReserved: false }), 'late-capture')
})

test('a duplicate confirmed capture is idempotent', () => {
  assert.equal(evaluateRazorpay({ ...pendingOrder(), status: 'paid', razorpayPaymentId: 'pay_local' }), 'duplicate')
})

test('a mismatched amount or provider order never settles', () => {
  assert.equal(evaluateRazorpay(pendingOrder(), { ...capturedRazorpay(), amount: 12499 }), 'mismatch')
  assert.equal(evaluateCapture({ order: pendingOrder(), payment: capturedRazorpay(), providerOrderId: 'different', paymentOrderId: 'rzp-order-local', currency: 'MYR', expectedAmount: 12500 }), 'mismatch')
})

test('cancellation is allowed only for pending orders with verified unpaid or failed provider state', () => {
  assert.equal(canCancelOrder({ status: 'pending', providerState: 'unpaid' }), true)
  assert.equal(canCancelOrder({ status: 'pending', providerState: 'failed' }), true)
  assert.equal(canCancelOrder({ status: 'pending', providerState: 'in-progress' }), false)
  assert.equal(canCancelOrder({ status: 'pending', providerState: 'unknown' }), false)
  assert.equal(canCancelOrder({ status: 'paid', providerState: 'unpaid' }), false)
  assert.equal(canCancelOrder({ status: 'pending', paymentProcessing: true, providerState: 'unpaid' }), false)
})

test('provider status snapshots distinguish in-flight from failed payment attempts', () => {
  assert.equal(classifyRazorpayPayments({ status: 'created' }, { items: [] }), 'unpaid')
  assert.equal(classifyRazorpayPayments({ status: 'paid' }, { items: [] }), 'captured')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [{ status: 'captured' }] }), 'captured')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [{ status: 'authorized' }] }), 'in-progress')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [{ status: 'created' }] }), 'in-progress')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [] }), 'unknown')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [{ status: 'failed' }] }), 'failed')
  assert.equal(classifyRazorpayPayments({ status: 'attempted' }, { items: [{ status: 'failed' }, { status: 'authorized' }] }), 'in-progress')
  assert.equal(classifyRazorpayPayments({ status: 'unknown-status' }, { items: [] }), 'unknown')
  assert.equal(classifyPayPalOrderStatus('CREATED'), 'unpaid')
  assert.equal(classifyPayPalOrderStatus('VOIDED'), 'unpaid')
  assert.equal(classifyPayPalOrderStatus('COMPLETED'), 'captured')
  assert.equal(classifyPayPalOrderStatus('APPROVED'), 'in-progress')
  assert.equal(classifyPayPalOrderStatus('PAYER_ACTION_REQUIRED'), 'in-progress')
  assert.equal(classifyPayPalOrderStatus('SAVED'), 'unknown')
  assert.equal(classifyPayPalOrder({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'COMPLETED' }] } }] }), 'captured')
  assert.equal(classifyPayPalOrder({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'PENDING' }] } }] }), 'in-progress')
  assert.equal(classifyPayPalOrder({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ status: 'DECLINED' }, { status: 'FAILED' }] } }] }), 'failed')
  assert.equal(classifyPayPalOrder({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [] } }] }), 'unknown')
  assert.equal(classifyPayPalOrder({ status: 'APPROVED' }), 'in-progress')
})

test('missing payment, PayPal COMPLETED capture, and paid-but-different id are classified', () => {
  assert.equal(evaluateRazorpay(pendingOrder(), null), 'not-captured')
  assert.equal(evaluateCapture({
    order: pendingOrder(),
    payment: { id: 'CAP-1', status: 'COMPLETED', currency: 'MYR', amount: 12500 },
    providerOrderId: 'paypal-order',
    paymentOrderId: 'paypal-order',
    currency: 'MYR',
    expectedAmount: 12500,
  }), 'settle')
  assert.equal(evaluateCapture({
    order: { ...pendingOrder(), status: 'paid', paypalCaptureId: 'CAP-1' },
    payment: { id: 'CAP-1', status: 'COMPLETED', currency: 'MYR', amount: 12500 },
    providerOrderId: 'paypal-order',
    paymentOrderId: 'paypal-order',
    currency: 'MYR',
    expectedAmount: 12500,
  }), 'duplicate')
  assert.equal(evaluateRazorpay({ ...pendingOrder(), status: 'paid', razorpayPaymentId: 'pay_other' }), 'late-capture')
  assert.equal(evaluateRazorpay(pendingOrder(), { ...capturedRazorpay(), currency: 'INR' }), 'mismatch')
})

test('orders without a provider payment are unpaid and not cancellable while processing', () => {
  return getProviderPaymentState({ paymentProvider: null }).then((result) => {
    assert.equal(result.state, 'unpaid')
    assert.equal(result.provider, null)
    assert.equal(canCancelOrder({ status: 'cancelled', providerState: 'unpaid' }), false)
    assert.equal(canCancelOrder({ status: 'pending', providerState: 'captured' }), false)
  })
})
