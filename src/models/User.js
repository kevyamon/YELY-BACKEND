// src/models/User.js
// MODELE UTILISATEUR - Profils, Identites & Stats (Iron Dome)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { SECURITY_CONSTANTS } = require('../config/env');

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Le nom est obligatoire'],
    trim: true,
    minlength: [2, 'Le nom doit faire au moins 2 caracteres'],
    maxlength: [50, 'Le nom ne peut depasser 50 caracteres'],
    match: [/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Caracteres non autorises dans le nom']
  },
  email: { 
    type: String, 
    required: [true, 'L\'email est obligatoire'],
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: [254, 'Email trop long'],
    match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Format email invalide']
  },
  phone: { 
    type: String, 
    required: [true, 'Le telephone est obligatoire'],
    unique: true,
    trim: true,
    match: [/^\+?[0-9\s]{8,20}$/, 'Format telephone invalide']
  },
  password: { 
    type: String, 
    required: [true, 'Le mot de passe est obligatoire'],
    minlength: [8, 'Mot de passe trop court'],
    select: false 
  },
  role: {
    type: String,
    enum: {
      values: ['rider', 'driver', 'admin', 'superadmin'],
      message: 'Role {VALUE} non autorise'
    },
    default: 'rider'
  },
  isBanned: { type: Boolean, default: false, index: true },
  banReason: { type: String, default: '', maxlength: 500 },
  
  // Securite Anti-Bruteforce
  loginAttempts: { type: Number, required: true, default: 0 },
  lockUntil: { type: Date },
  
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },

  fcmToken: { type: String, default: null },
  
  isAvailable: { type: Boolean, default: false, index: true },

  // STATS DASHBOARD : Suivi des performances
  totalRides: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  rating: { type: Number, default: 5.0 },
  ratingCount: { type: Number, default: 0 },
  
  vehicle: {
    category: { type: String, enum: ['ECHO', 'STANDARD', 'VIP'], default: null },
    model: { type: String, default: '' },
    plate: { type: String, default: '' },
    color: { type: String, default: '' }
  },
  
  subscription: {
    isActive: { type: Boolean, default: false, index: true },
    hoursRemaining: { type: Number, default: 0 },
    lastCheckTime: { type: Date, default: Date.now }
  },
  
  documents: {
    idCard: { type: String, default: '' },
    license: { type: String, default: '' },
    insurance: { type: String, default: '' }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

userSchema.index({ currentLocation: '2dsphere' });

// Normalisation avant validation
userSchema.pre('validate', function(next) {
  if (this.email) this.email = this.email.toLowerCase().trim();
  if (this.phone) this.phone = this.phone.replace(/[\s-]/g, '');
  if (this.name) this.name = this.name.replace(/\s+/g, ' ').trim();
  next();
});

// Hashage du mot de passe
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const rounds = SECURITY_CONSTANTS?.BCRYPT_ROUNDS || 12;
    this.password = await bcrypt.hash(this.password, rounds);
    next();
  } catch (error) {
    next(new Error('Erreur de securisation du mot de passe: ' + error.message));
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// SECURITE RENDER : Empeche le crash OverwriteModelError
const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;