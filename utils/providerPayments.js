const { getRazorpay } = require('./razorpay')
const { PAYPAL_BASE, getPayPalAccessToken } = require('./paypal')
const { canCancelOrder } = require('./paymentState')

function classifyRazorpayPayments(remoteOrder, payments) {
  const items = payments?.items || []
  if (remoteOrder?.status === 'paid' || items.some((payment) => payment.status === 'captured')) return 'captured'
  if (items.some((payment) => payment.status === 'authorized' || payment.status === 'created')) return 'in-progress'
  if (remoteOrder?.status === 'attempted' && items.length === 0) return 'unknown'
  if (items.length && items.every((payment) => payment.status === 'failed')) return 'failed'
  return remoteOrder?.status === 'created' ? 'unpaid' : 'unknown'
}

function classifyPayPalOrderStatus(status) {
  if (['CREATED', 'VOIDED'].includes(status)) return 'unpaid'
  if (status === 'APPROVED') return 'in-progress'
  if (status === 'COMPLETED') return 'captured'
  if (status === 'PAYER_ACTION_REQUIRED') return 'in-progress'
  return 'unknown'
}

function classifyPayPalOrder(remoteOrder) {
  const state = classifyPayPalOrderStatus(remoteOrder?.status)
  if (state !== 'captured') return state
  const captures = remoteOrder.purchase_units?.flatMap((unit) => unit.payments?.captures || []) || []
  if (captures.some((capture) => capture.status === 'COMPLETED')) return 'captured'
  if (captures.some((capture) => capture.status === 'PENDING')) return 'in-progress'
  if (captures.length && captures.every((capture) => ['DECLINED', 'FAILED'].includes(capture.status))) return 'failed'
  return 'unknown'
}

async function getProviderPaymentState(order) {
  if (order.paymentProvider === 'razorpay' && order.razorpayOrderId) {
    const gateway = getRazorpay()
    const [remoteOrder, payments] = await Promise.all([
      gateway.orders.fetch(order.razorpayOrderId),
      gateway.orders.fetchPayments(order.razorpayOrderId),
    ])
    return { provider: 'razorpay', state: classifyRazorpayPayments(remoteOrder, payments), payments: payments?.items || [] }
  }

  if (order.paymentProvider === 'paypal' && order.paypalOrderId) {
    const accessToken = await getPayPalAccessToken()
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(order.paypalOrderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) throw new Error('Unable to verify the PayPal order status')
    const remoteOrder = await response.json()
    return { provider: 'paypal', state: classifyPayPalOrder(remoteOrder), remoteOrder }
  }

  return { provider: order.paymentProvider || null, state: 'unpaid' }
}

module.exports = { classifyRazorpayPayments, classifyPayPalOrderStatus, classifyPayPalOrder, getProviderPaymentState, canCancelOrder }
