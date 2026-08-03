const cloudinary = require('cloudinary').v2
const { CloudinaryStorage } = require('multer-storage-cloudinary')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '')
    return {
      folder: 'ayusydah-products',
      allowed_formats: ['jpg', 'jpeg', 'png', 'svg'],
      public_id: nameWithoutExt,
    }
  },
})

module.exports = { cloudinary, storage }