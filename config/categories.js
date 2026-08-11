const CATEGORY_ALIASES = {
  'Health Concerns': ['Health Concerns', 'Vitamins & Supplements', 'Protein & Fitness', 'Wellness', 'Sports Nutrition'],
  Ayurveda: ['Ayurveda'],
  'Beauty & Hair': ['Beauty & Hair', 'Beauty & Slimming'],
  'Food & Nutrition': ['Food & Nutrition', 'Food'],
  Brands: ['Brands'],
}

const canonicalCategory = (category) => {
  const value = String(category || '').trim()
  return Object.entries(CATEGORY_ALIASES).find(([, aliases]) => aliases.includes(value))?.[0] || value
}

const categoryValues = (category) => CATEGORY_ALIASES[canonicalCategory(category)] || [String(category || '').trim()]

module.exports = { CATEGORY_ALIASES, canonicalCategory, categoryValues }
