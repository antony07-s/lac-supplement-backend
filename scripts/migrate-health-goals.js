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
  ['Resveratrol', 'Health Concerns', ['Heart Health']],
  ['Pumpkin Seed', 'Food & Nutrition', ['Immune Support', "Men's Wellness"]],
  ['Prostate', 'Health Concerns', ["Men's Wellness"]],
  ['Probiotics', 'Health Concerns', ['Digestive Health']],
  ['Piles', 'Health Concerns', ['Digestive Health']],
  ['Mookirattai', 'Health Concerns', ['Kidney Health']],
  ['Memory Booster', 'Health Concerns', ['Mind & Stress Support']],
  ['AYUSYDAH Liver', 'Health Concerns', ['Liver Health', 'Metabolic Health']],
  ['Kidney Guard', 'Health Concerns', ['Kidney Health']],
  ['Golden Turmeric Soap', 'Beauty & Hair', ['Skin Health']],
  ['Aloe Vera Glow Soap', 'Beauty & Hair', ['Skin Health']],
  ['Eyerevive-t', 'Beauty & Hair', []],
  ['Pomegranate Extract', 'Food & Nutrition', ['Heart Health']],
  ['Nerve Care', 'Health Concerns', ['Mind & Stress Support']],
  ['Fat Burn Plus', 'Health Concerns', ['Weight Management', 'Metabolic Health']],
  ['Natural Virgin Coconut Soap', 'Beauty & Hair', ['Skin Health']],
  ['Goatmilk Brightening Soap', 'Beauty & Hair', ['Skin Health']],
  ['Spemax', 'Health Concerns', ["Men's Wellness"]],
  ['Kumkumadi Soap', 'Beauty & Hair', ['Skin Health']],
  ['Shilajit', 'Ayurveda', ['Energy & Vitality', "Men's Wellness"]],
  ['chocolate', 'Health Concerns', ['Heart Health']],
  ['Eye Revive', 'Beauty & Hair', ['Skin Health']],
  ['Xtra Gold X', 'Health Concerns', ["Men's Wellness", 'Energy & Vitality']],
  ['Tooth & Gum Care', 'Health Concerns', []],
  ['Thyroid Support', 'Health Concerns', ['Metabolic Health', 'Energy & Vitality']],
  ['Sperm Boost', 'Health Concerns', ["Men's Wellness"]],
  ['Prediacare', 'Health Concerns', ['Metabolic Health']],
  ['Acne & Pimple Defense', 'Beauty & Hair', ['Skin Health']],
  ['Ashwagandha', 'Ayurveda', ['Mind & Stress Support', 'Energy & Vitality']],
  ['Antioxidant Blueberry', 'Food & Nutrition', ['Immune Support']],
  ['Broccoli Sprout', 'Food & Nutrition', ['Immune Support']],
  ['Carrot Extract', 'Food & Nutrition', ['Skin Health']],
  ['Colon Cleanser', 'Health Concerns', ['Digestive Health']],
  ['Curcumin', 'Ayurveda', ['Bones & Joints']],
  ['Fenugreek Extract', 'Food & Nutrition', ['Metabolic Health', 'Digestive Health']],
  ['Flaxseed', 'Food & Nutrition', ['Heart Health', 'Digestive Health']],
  ['Garlic Pure Extract', 'Health Concerns', ['Heart Health', 'Immune Support']],
  ['Gastric Care', 'Health Concerns', ['Digestive Health']],
  ['Grape Seed Extract', 'Food & Nutrition', ['Heart Health', 'Skin Health']],
  ['Green Spirulina', 'Food & Nutrition', ['Energy & Vitality', 'Immune Support']],
  ['Blood Pressure', 'Health Concerns', ['Heart Health']],
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

  // Fix the malformed duplicated Ayurveda image URL already in the live category data.
  await Category.updateOne({ name: 'Ayurveda' }, { $set: { image: 'https://images.unsplash.com/photo-1492552181161-62217fc3076d?auto=format&fit=crop&w=800&q=80' } })

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
