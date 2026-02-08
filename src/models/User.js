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
    type: { 
      type: String, 
      enum: ['ECHO', 'STANDARD', 'VIP'],
      required: function() { return this.role === 'driver'; }
    },
    model: String,
    plate: String,
    color: String
  },

  // --- ABONNEMENT ---
  subscription: {
    isActive: { type: Boolean, default: false },
    hoursRemaining: { type: Number, default: 0 },
    lastCheckTime: { type: Date, default: Date.now }
  },

  // --- DOCUMENTS ---
  documents: {
    idCard: String,
    license: String,
    insurance: String
  }
}, { timestamps: true });

userSchema.index({ currentLocation: '2dsphere' });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);