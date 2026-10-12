const fs = require('node:fs')
const path = require('node:path')

const backendRoot = path.join(__dirname, '..')
const mappingPath = path.join(backendRoot, 'videos-mapping.csv')
const catalogPath = path.join(backendRoot, 'videos-product-catalog.csv')

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(value); rows.push(row); row = []; value = ''
    } else value += char
  }
  if (quoted) throw new Error('CSV has an unclosed quote.')
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows.filter((cells) => cells.some((cell) => String(cell || '').trim()))
}

function readCsv(filePath, requiredHeaders) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
  if (!rows.length) throw new Error(`${path.basename(filePath)} is empty.`)
  const headers = rows[0].map((header) => header.trim())
  const missing = requiredHeaders.filter((header) => !headers.includes(header))
  if (missing.length) throw new Error(`${path.basename(filePath)} is missing columns: ${missing.join(', ')}.`)
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] || '').trim()])))
}

async function main() {
  const rows = readCsv(mappingPath, ['productName', 'videoUrl', 'confidence'])
  const catalogRows = readCsv(catalogPath, ['productName'])
  const catalogNames = catalogRows.map((row) => row.productName).filter(Boolean)
  const catalogCounts = new Map()
  for (const name of catalogNames) catalogCounts.set(name, (catalogCounts.get(name) || 0) + 1)

  const byName = new Map()
  for (const row of rows) {
    if (row.confidence !== 'high') throw new Error(`Mapping for "${row.productName}" is not high confidence; only high-confidence rows can be linked.`)
    let url
    try { url = new URL(row.videoUrl) } catch { throw new Error(`Invalid video URL for "${row.productName}".`) }
    if (url.protocol !== 'https:') throw new Error(`Video URL for "${row.productName}" must use HTTPS.`)
    if (!row.productName) throw new Error('A mapping row has no productName.')
    if (!byName.has(row.productName)) byName.set(row.productName, new Set())
    byName.get(row.productName).add(url.href)
  }

  const productNames = [...byName.keys()]
  const notInCatalog = productNames.filter((name) => !catalogCounts.has(name))
  const repeatedCatalogNames = productNames.filter((name) => (catalogCounts.get(name) || 0) > 1)
  const preview = rows.slice(0, 10).map(({ productName, videoUrl }) => ({ productName, videoUrl }))

  console.log(`High-confidence video rows: ${rows.length}`)
  console.log(`Distinct products to update: ${productNames.length}`)
  console.log(`Names not found in local product catalog: ${notInCatalog.length}`)
  console.log(`Names repeated in local product catalog: ${repeatedCatalogNames.length}`)
  console.log('First 10 mapping rows:')
  console.log(JSON.stringify(preview, null, 2))

  if (notInCatalog.length || repeatedCatalogNames.length) {
    if (notInCatalog.length) console.log(`Not in local catalog: ${notInCatalog.join(' | ')}`)
    if (repeatedCatalogNames.length) console.log(`Repeated locally: ${repeatedCatalogNames.join(' | ')}`)
  }

  if (!process.argv.includes('--apply')) {
    console.log('Dry run only. No MongoDB connection was made. Add --apply to update products.')
    return
  }

  require('dotenv').config({ quiet: true })
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.')
  const mongoose = require('mongoose')
  const Product = require('../models/Product')
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
    const matches = await Product.find({ name: { $in: productNames } }).select('_id name').lean()
    const recordsByName = new Map()
    for (const product of matches) {
      if (!recordsByName.has(product.name)) recordsByName.set(product.name, [])
      recordsByName.get(product.name).push(product)
    }

    const ambiguous = productNames.filter((name) => (recordsByName.get(name) || []).length > 1)
    const notFound = productNames.filter((name) => !recordsByName.has(name))
    if (ambiguous.length) {
      console.error(`Stopped before writing: ${ambiguous.length} product names match multiple database records.`)
      console.error(ambiguous.join('\n'))
      return
    }

    let updated = 0
    for (const name of productNames) {
      const product = recordsByName.get(name)?.[0]
      if (!product) continue
      await Product.updateOne({ _id: product._id }, { $set: { videos: [...byName.get(name)] } })
      updated += 1
    }
    console.log(`Updated products: ${updated}`)
    console.log(`Names not found in database: ${notFound.length}`)
    if (notFound.length) console.log(notFound.join('\n'))
  } catch (error) {
    let message = String(error?.message || '')
    if (process.env.MONGO_URI) message = message.replaceAll(process.env.MONGO_URI, '[redacted connection string]')
    message = message.replace(/mongodb(?:\+srv)?:\/\/[^\s'"`]+/gi, '[redacted connection string]')
    console.error(`Video linking failed (${error?.name || 'MongoDB error'}): ${message.slice(0, 500) || 'connection or query failed'}`)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
