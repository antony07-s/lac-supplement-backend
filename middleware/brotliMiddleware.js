const zlib = require('zlib')

// The API's JSON responses are buffered by Express before res.end. Compress
// those responses with Brotli when supported; compression() handles gzip and
// streamed responses.
function brotliMiddleware() {
  return (req, res, next) => {
    if (req.method !== 'GET' || req.acceptsEncodings('br') !== 'br') return next()

    const originalEnd = res.end.bind(res)
    res.end = (chunk, encoding, callback) => {
      let body = chunk
      let charset = encoding
      let done = callback
      if (typeof body === 'function') { done = body; body = undefined; charset = undefined }
      else if (typeof charset === 'function') { done = charset; charset = undefined }
      if (res.headersSent || !body || res.statusCode === 204 || res.statusCode === 304) return originalEnd(body, charset, done)

      const contentType = String(res.getHeader('Content-Type') || '')
      if (!/^(application\/(?:json|xml)|text\/)/i.test(contentType)) return originalEnd(body, charset, done)
      const raw = Buffer.isBuffer(body) ? body : Buffer.from(body, charset)
      if (raw.length < 1024) return originalEnd(body, charset, done)

      zlib.brotliCompress(raw, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
      }, (error, compressed) => {
        if (error) return originalEnd(body, charset, done)
        res.removeHeader('Content-Length')
        res.removeHeader('ETag')
        res.setHeader('Content-Encoding', 'br')
        res.vary('Accept-Encoding')
        originalEnd(compressed, done)
      })
      return res
    }
    next()
  }
}

module.exports = brotliMiddleware
