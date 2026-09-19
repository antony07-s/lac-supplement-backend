// require('dotenv').config()
// const { cloudinary } = require('../config/cloudinary')

// // Non-branded botanical backdrop from Unsplash. Keep source attribution in this
// // script so the asset provenance remains documented after Cloudinary upload.
// const assets = [
//   {
//     publicId: 'botanical-aloe-hero-backdrop',
//     source: 'https://images.unsplash.com/photo-1665725435867-372ecf96f91d?auto=format&fit=crop&fm=jpg&q=90&w=2400',
//     attribution: 'Lulu Lovering / Unsplash',
//   },
//   {
//     publicId: 'herbal-supplements',
//     source: 'https://images.unsplash.com/photo-1514733670139-4d87a1941d55?auto=format&fit=crop&fm=jpg&q=90&w=1800',
//     attribution: 'Lisa Hobbs / Unsplash',
//   },
//   {
//     publicId: 'ayurvedic-wellness',
//     source: 'https://images.unsplash.com/photo-1665725435867-372ecf96f91d?auto=format&fit=crop&fm=jpg&q=90&w=1800',
//     attribution: 'Lulu Lovering / Unsplash',
//   },
//   {
//     publicId: 'natural-juices',
//     source: 'https://images.unsplash.com/photo-1623227773277-a4e4a5f40284?auto=format&fit=crop&fm=jpg&q=90&w=1800',
//     attribution: 'Olena Bohovyk / Unsplash',
//   },
//   {
//     publicId: 'skin-hair-care',
//     source: 'https://images.unsplash.com/photo-1699373383905-d0eafdffe5c1?auto=format&fit=crop&fm=jpg&q=90&w=1800',
//     attribution: 'Mockup Free / Unsplash',
//   },
//   {
//     publicId: 'professional-wellness-hero',
//     source: 'https://images.pexels.com/photos/7317090/pexels-photo-7317090.jpeg?auto=compress&cs=tinysrgb&w=2400',
//     attribution: 'BEAUDEC / Pexels',
//   },
// ]

// async function run() {
//   const uploaded = []
//   for (const asset of assets) {
//     const result = await cloudinary.uploader.upload(asset.source, {
//       folder: 'ayusydah-home',
//       public_id: asset.publicId,
//       overwrite: false,
//       resource_type: 'image',
//       tags: ['homepage', 'licensed-source', 'unsplash'],
//       context: `attribution=${asset.attribution}|source=${asset.source}`,
//     })
//     uploaded.push({ publicId: result.public_id, secureUrl: result.secure_url, attribution: asset.attribution })
//   }
//   console.log(JSON.stringify(uploaded, null, 2))
// }

// run().catch((error) => { console.error(error); process.exit(1) })
