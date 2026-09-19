require('dotenv').config()
const mongoose = require('mongoose')
const Product = require('../models/Product')
const HealthGoal = require('../models/HealthGoal')
const Category = require('../models/Category')
const Review = require('../models/Review')

const GOALS = [
  'Bones & Joints', 'Digestive Health', 'Heart Health', 'Immune Support',
  'Energy & Vitality', 'Weight Management', 'Mind & Stress Support',
  'Skin Health', "Men's Wellness", 'Kidney Health', 'Liver Health', 'Metabolic Health',
]

// Every assignment below was reviewed against the live product description and benefits.
const mappings = [
  ['Resveratrol', 'Herbal Supplements', ['Heart Health']],
  ['Pumpkin Seed', 'Herbal Supplements', ['Immune Support', "Men's Wellness"]],
  ['Prostate', 'Herbal Supplements', ["Men's Wellness"]],
  ['Probiotics', 'Herbal Supplements', ['Digestive Health']],
  ['Piles', 'Herbal Supplements', ['Digestive Health']],
  ['Mookirattai', 'Herbal Supplements', ['Kidney Health']],
  ['Memory Booster', 'Herbal Supplements', ['Mind & Stress Support']],
  ['AYUSYDAH Liver', 'Herbal Supplements', ['Liver Health', 'Metabolic Health']],
  ['Kidney Guard', 'Herbal Supplements', ['Kidney Health']],
  ['Golden Turmeric Soap', 'Skin & Hair Care', ['Skin Health']],
  ['Aloe Vera Glow Soap', 'Skin & Hair Care', ['Skin Health']],
  ['Eyerevive-t', 'Skin & Hair Care', []],
  ['Pomegranate Extract', 'Herbal Supplements', ['Heart Health']],
  ['Nerve Care', 'Herbal Supplements', ['Mind & Stress Support']],
  ['Fat Burn Plus', 'Herbal Supplements', ['Weight Management', 'Metabolic Health']],
  ['Natural Virgin Coconut Soap', 'Skin & Hair Care', ['Skin Health']],
  ['Goatmilk Brightening Soap', 'Skin & Hair Care', ['Skin Health']],
  ['Spemax', 'Herbal Supplements', ["Men's Wellness"]],
  ['Kumkumadi Soap', 'Skin & Hair Care', ['Skin Health']],
  ['Shilajit', 'Ayurvedic Wellness', ['Energy & Vitality', "Men's Wellness"]],
  ['chocolate', 'Herbal Supplements', ['Heart Health']],
  ['Eye Revive', 'Skin & Hair Care', ['Skin Health']],
  ['Xtra Gold X', 'Herbal Supplements', ["Men's Wellness", 'Energy & Vitality']],
  ['Tooth & Gum Care', 'Herbal Supplements', []],
  ['Thyroid Support', 'Herbal Supplements', ['Metabolic Health', 'Energy & Vitality']],
  ['Sperm Boost', 'Herbal Supplements', ["Men's Wellness"]],
  ['Prediacare', 'Herbal Supplements', ['Metabolic Health']],
  ['Acne & Pimple Defense', 'Skin & Hair Care', ['Skin Health']],
  ['Ashwagandha', 'Ayurvedic Wellness', ['Mind & Stress Support', 'Energy & Vitality']],
  ['Antioxidant Blueberry', 'Herbal Supplements', ['Immune Support']],
  ['Broccoli Sprout', 'Herbal Supplements', ['Immune Support']],
  ['Carrot Extract', 'Herbal Supplements', ['Skin Health']],
  ['Colon Cleanser', 'Herbal Supplements', ['Digestive Health']],
  ['Curcumin', 'Ayurvedic Wellness', ['Bones & Joints']],
  ['Fenugreek Extract', 'Herbal Supplements', ['Metabolic Health', 'Digestive Health']],
  ['Flaxseed', 'Herbal Supplements', ['Heart Health', 'Digestive Health']],
  ['Garlic Pure Extract', 'Herbal Supplements', ['Heart Health', 'Immune Support']],
  ['Gastric Care', 'Herbal Supplements', ['Digestive Health']],
  ['Grape Seed Extract', 'Herbal Supplements', ['Heart Health', 'Skin Health']],
  ['Green Spirulina', 'Herbal Supplements', ['Energy & Vitality', 'Immune Support']],
  ['Blood Pressure', 'Herbal Supplements', ['Heart Health']],
]

const goalImageProducts = {
  'Bones & Joints': 'Curcumin',
  'Digestive Health': 'Probiotics',
  'Heart Health': 'Resveratrol',
  'Immune Support': 'Pumpkin Seed',
  'Energy & Vitality': 'Shilajit',
  'Weight Management': 'Fat Burn Plus',
  'Mind & Stress Support': 'Ashwagandha',
  'Skin Health': 'Golden Turmeric Soap',
  "Men's Wellness": 'Prostate',
  'Kidney Health': 'Mookirattai',
  'Liver Health': 'AYUSYDAH Liver',
  'Metabolic Health': 'Prediacare',
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  for (const name of GOALS) {
    await HealthGoal.updateOne({ name }, { $setOnInsert: { name, image: '' } }, { upsert: true })
  }
  await HealthGoal.updateOne({ name: 'Stress Relief' }, { $set: { name: 'Mind & Stress Support' } })
  await HealthGoal.deleteOne({ name: 'Sleep Support' })

  for (const [needle, category, healthGoals] of mappings) {
    const result = await Product.updateOne({ name: { $regex: needle, $options: 'i' } }, { $set: { category, healthGoals } })
    if (result.matchedCount !== 1) console.warn(`Expected one product for ${needle}; found ${result.matchedCount}`)
  }

  // Goal cards use a real, relevant catalog image rather than unrelated stock imagery.
  for (const [goal, needle] of Object.entries(goalImageProducts)) {
    const product = await Product.findOne({ name: { $regex: needle, $options: 'i' } }).select('image').lean()
    if (product?.image) await HealthGoal.updateOne({ name: goal }, { $set: { image: product.image } })
  }

  // Fix the malformed duplicated Ayurvedic Wellness image URL in the live category data.
  await Category.updateOne({ name: 'Ayurvedic Wellness' }, { $set: { image: 'https://images.unsplash.com/photo-1492552181161-62217fc3076d?auto=format&fit=crop&w=800&q=80' } })

  // Remove legacy/manual ratings. Only approved customer reviews may determine these fields.
  const products = await Product.find().select('_id').lean()
  for (const product of products) {
    const [summary] = await Review.aggregate([
      { $match: { product: product._id, status: 'approved' } },
      { $group: { _id: null, rating: { $avg: '$rating' }, reviews: { $sum: 1 } } },
    ])
    await Product.updateOne({ _id: product._id }, {
      $set: { rating: summary ? Math.round(summary.rating * 10) / 10 : 0, reviews: summary?.reviews || 0 },
    })
  }
  const uncategorized = await Product.countDocuments({ healthGoals: { $exists: false } })
  console.log(`Migration complete. Products without a healthGoals field: ${uncategorized}`)
  await mongoose.disconnect()
}

run().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exit(1) })
