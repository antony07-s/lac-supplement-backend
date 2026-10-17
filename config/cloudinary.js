const cloudinary = require('cloudinary').v2
const { CloudinaryStorage } = require('multer-storage-cloudinary-v2')
const { randomUUID } = require('crypto')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    return {
      folder: 'ayusydah-products',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      public_id: randomUUID(),
    }
  },
})

const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder: 'ayusydah-products/videos',
    resource_type: 'video',
    allowed_formats: ['mp4', 'webm', 'mov'],
    public_id: randomUUID(),
  }),
})

module.exports = { cloudinary, storage, videoStorage }
