// src/models/User.js
// MODELE UTILISATEUR - Profils, Identites & Stats
// STANDARD: Industriel (Validation assouplie & Securite Renforcee)

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { SECURITY_CONSTANTS } = require('../config/env');

const hashWithPepper = (password) => {
  const pepper = process.env.PASSWORD_PEPPER;
  if (!pepper) {
    console.warn('ATTENTION: VARIABLE D ENVIRONNEMENT PASSWORD_PEPPER MANQUANTE. UTILISATION D UN REPLI MOINS SECURISE.');
    return crypto.createHash('sha256').update(password).digest('hex');
  }
  return crypto.createHmac('sha256', pepper).update(password).digest('hex');
};

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
  profilePicture: { 
    type: String, 
    default: '' 
  },
  role: {
    type: String,
    enum: {
      values: ['rider', 'driver', 'admin', 'superadmin'],
      message: 'Role {VALUE} non autorise'
    },
    default: 'rider'
  },
  previousRole: {
    type: String,
    enum: ['rider', 'driver', null],
    default: null
  },
  isBanned: { type: Boolean, default: false, index: true },
  banReason: { type: String, default: '', maxlength: 500 },
  
  isDeleted: { type: Boolean, default: false, index: true },
  
  loginAttempts: { type: Number, required: true, default: 0 },
  lockUntil: { type: Date },

  resetPasswordOtp: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },

  fcmToken: { type: String, default: null, select: false },
  
  isAvailable: { type: Boolean, default: false, index: true },

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
    expiresAt: { type: Date, default: null }, 
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

userSchema.methods.syncSubscription = function() {
  if (!this.subscription || this.role !== 'driver') return false;
  let changed = false;
  if (this.subscription.expiresAt) {
    const now = new Date();
    if (now >= this.subscription.expiresAt) {
      if (this.subscription.isActive || this.subscription.hoursRemaining > 0) {
        this.subscription.isActive = false;
        this.subscription.hoursRemaining = 0;
        changed = true;
      }
    } else {
      const hoursLeft = Math.ceil((this.subscription.expiresAt - now) / (1000 * 60 * 60));
      if (this.subscription.hoursRemaining !== hoursLeft || !this.subscription.isActive) {
        this.subscription.hoursRemaining = Math.max(0, hoursLeft);
        this.subscription.isActive = true;
        changed = true;
      }
    }
  }
  if (changed) this.subscription.lastCheckTime = new Date();
  return changed;
};

userSchema.pre('validate', function(next) {
  if (this.email) this.email = this.email.toLowerCase().trim();
  
  if (this.phone) {
    this.phone = String(this.phone).replace(/[\s-]/g, '');
    if (this.phone.length === 9 && !this.phone.startsWith('+')) {
      this.phone = '0' + this.phone;
    }
  }

  if (this.name && this.name !== 'Utilisateur Supprimé') {
    this.name = this.name.replace(/\s+/g, ' ').trim();
  }
  next();
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const rounds = SECURITY_CONSTANTS?.BCRYPT_ROUNDS || 12;
    const pepperedPassword = hashWithPepper(this.password);
    this.password = await bcrypt.hash(pepperedPassword, rounds);
    next();
  } catch (error) {
    next(new Error('Erreur de securisation du mot de passe: ' + error.message));
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  const pepperedPassword = hashWithPepper(candidatePassword);
  return bcrypt.compare(pepperedPassword, this.password);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;