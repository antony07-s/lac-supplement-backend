function evaluateCapture({ order, payment, providerOrderId, currency, expectedAmount, paymentOrderId }) {
  if (!payment || payment.status !== 'captured' && payment.status !== 'COMPLETED') return 'not-captured'
  if (paymentOrderId !== providerOrderId || payment.currency !== currency || payment.amount !== expectedAmount) return 'mismatch'
  if (order.status === 'paid' && (order.razorpayPaymentId === payment.id || order.paypalCaptureId === payment.id)) return 'duplicate'
  if (order.status === 'pending' && order.stockReserved !== false) return 'settle'
  return 'late-capture'
}

function canCancelOrder({ status, paymentProcessing, providerState }) {
  return status === 'pending' && paymentProcessing !== true && ['unpaid', 'failed'].includes(providerState)
}

module.exports = { evaluateCapture, canCancelOrder }
