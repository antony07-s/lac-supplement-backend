const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
  },
  password: { type: String, required: true, select: false, minlength: 8, maxlength: 128 },
  isAdmin: { type: Boolean, default: false },
}, { timestamps: true })

// Registration hashes explicitly, and this guard also prevents future code paths
// from accidentally persisting a raw password.
userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password') || /^\$2[aby]\$\d{2}\$/.test(this.password)) return
  this.password = await bcrypt.hash(this.password, 12)
})

module.exports = mongoose.model('User', userSchema)
