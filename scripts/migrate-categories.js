require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../models/Product')
const Category = require('../models/Category')
const { canonicalCategory } = require('../config/categories')

// One-time catalogue migration. Legacy URL compatibility remains in config/categories.js.
const CATEGORY_MAPPING = {
  'Health Concerns': 'Herbal Supplements',
  'Food & Nutrition': 'Herbal Supplements',
  Ayurveda: 'Ayurvedic Wellness',
  'Nutrition & Juices': 'Juices',
  'Beauty & Hair': 'Skin & Hair Care',
  Brands: 'Brands',
}

const OLD_CATEGORIES = Object.keys(CATEGORY_MAPPING)
const NEW_CATEGORIES = [...new Set(Object.values(CATEGORY_MAPPING))]

const getCounts = async (categories) => {
  const rows = await Product.aggregate([
    { $match: { category: { $in: categories } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ])
  const counts = Object.fromEntries(rows.map(({ _id, count }) => [_id, count]))
  return Object.fromEntries(categories.map((category) => [category, counts[category] || 0]))
}

async function run() {
  // Local development can opt into this only when an enterprise proxy replaces
  // the database certificate; production continues to verify certificates.
  const connectionOptions = process.env.MIGRATION_ALLOW_INVALID_CERT === 'true'
    ? { tlsAllowInvalidCertificates: true }
    : {}
  await mongoose.connect(process.env.MONGO_URI, connectionOptions)
  const before = await getCounts(OLD_CATEGORIES)

  for (const [from, to] of Object.entries(CATEGORY_MAPPING)) {
    await Product.updateMany({ category: from }, { $set: { category: to } })
  }

  // Rebuild the category documents with their new names. Existing images are
  // retained where a matching legacy document exists; product imagery is the
  // fallback for categories that did not previously have a category document.
  const legacyCategoryDocuments = await Category.find().lean()
  const fallbackImage = legacyCategoryDocuments.find((category) => category.image)?.image || ''
  for (const name of NEW_CATEGORIES) {
    const legacyImage = legacyCategoryDocuments.find((category) => canonicalCategory(category.name) === name)?.image
    const productImage = (await Product.findOne({ category: name }).select('image').lean())?.image
    await Category.updateOne(
      { name },
      { $set: { name, image: legacyImage || productImage || fallbackImage } },
      { upsert: true },
    )
  }
  // Keep legacy category documents intact for now. categoryRoutes canonicalizes
  // and de-duplicates them, so this migration never deletes administrator data.

  const after = await getCounts(NEW_CATEGORIES)
  console.log(JSON.stringify({ before, after, categories: NEW_CATEGORIES }, null, 2))
  await mongoose.disconnect()
}

run().catch(async (error) => {
  console.error(error)
  await mongoose.disconnect()
  process.exit(1)
})
