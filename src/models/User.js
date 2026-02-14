// src/models/User.js
// MODÈLE UTILISATEUR - Bank Grade & Mongoose Modern Fix

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { SECURITY_CONSTANTS } = require('../config/env');

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Le nom est obligatoire'],
    trim: true,
    minlength: [2, 'Le nom doit faire au moins 2 caractères'],
    maxlength: [50, 'Le nom ne peut dépasser 50 caractères'],
    match: [/^[a-zA-Z\u00C0-\u00FF\s'-]+$/, 'Caractères non autorisés dans le nom']
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
    required: [true, 'Le téléphone est obligatoire'],
    unique: true,
    trim: true,
    match: [/^\+?[0-9\s]{8,20}$/, 'Format téléphone invalide']
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
      message: 'Rôle {VALUE} non autorisé'
    },
    default: 'rider'
  },
  isBanned: { type: Boolean, default: false, index: true },
  banReason: { type: String, default: '', maxlength: 500 },
  currentLocation: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  isAvailable: { type: Boolean, default: false, index: true },
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

// 🛠️ FIX CRITIQUE : Plus de paramètre 'next' ici. On laisse la promesse (async) gérer le flux.
userSchema.pre('save', async function() {
  // Si le mot de passe n'est pas modifié, on sort directement
  if (!this.isModified('password')) return;
  
  try {
    // Utilisation sécurisée des constantes ou valeur par défaut
    const rounds = SECURITY_CONSTANTS?.BCRYPT_ROUNDS || 10;
    this.password = await bcrypt.hash(this.password, rounds);
  } catch (error) {
    // En cas d'erreur de hashage, on laisse Mongoose la remonter
    throw new Error('Erreur de sécurisation du mot de passe: ' + error.message);
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.statics.comparePasswordStatic = async function(candidate, hash) {
  return bcrypt.compare(candidate, hash);
};

module.exports = mongoose.model('User', userSchema);