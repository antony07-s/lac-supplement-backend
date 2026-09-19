const CATEGORY_ALIASES = {
  // Keep legacy values here so bookmarked category URLs and any un-migrated
  // product records continue to resolve to their new customer-facing category.
  'Herbal Supplements': ['Herbal Supplements', 'Health Concerns', 'Vitamins & Supplements', 'Protein & Fitness', 'Wellness', 'Sports Nutrition', 'Food & Nutrition', 'Food'],
  'Ayurvedic Wellness': ['Ayurvedic Wellness', 'Ayurveda'],
  Juices: ['Juices', 'Nutrition & Juices'],
  'Skin & Hair Care': ['Skin & Hair Care', 'Beauty & Hair', 'Beauty & Slimming'],
  Brands: ['Brands'],
}

const canonicalCategory = (category) => {
  const value = String(category || '').trim()
  return Object.entries(CATEGORY_ALIASES).find(([, aliases]) => aliases.includes(value))?.[0] || value
}

const categoryValues = (category) => CATEGORY_ALIASES[canonicalCategory(category)] || [String(category || '').trim()]

module.exports = { CATEGORY_ALIASES, canonicalCategory, categoryValues }
