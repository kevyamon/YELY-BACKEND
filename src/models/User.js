// backend/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['rider', 'driver', 'admin', 'superadmin'], 
    default: 'rider' 
  },
  
  // --- SÉCURITÉ ET DISCIPLINE ---
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: "" },

  // --- GÉOLOCALISATION ---
  currentLocation: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },

  // --- ÉTAT DU CHAUFFEUR ---
  isAvailable: { type: Boolean, default: false },
  vehicle: {
    category: { 
      type: String, 
      enum: ['ECHO', 'STANDARD', 'VIP'],
      default: null
    },
    model: { type: String, default: '' },
    plate: { type: String, default: '' },
    color: { type: String, default: '' }
  },

  // --- ABONNEMENT ---
  subscription: {
    isActive: { type: Boolean, default: false },
    hoursRemaining: { type: Number, default: 0 },
    lastCheckTime: { type: Date, default: Date.now }
  },

  // --- DOCUMENTS ---
  documents: {
    idCard: { type: String, default: '' },
    license: { type: String, default: '' },
    insurance: { type: String, default: '' }
  }
}, { timestamps: true });

userSchema.index({ currentLocation: '2dsphere' });

// IMPORTANT : async sans next — Mongoose résout la Promise automatiquement
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);