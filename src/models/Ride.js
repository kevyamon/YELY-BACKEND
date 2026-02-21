// src/models/User.js
// MODÈLE UTILISATEUR - Profils, Identités & Stats Performance (Iron Dome)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  phone: { 
    type: String, 
    required: true, 
    unique: true 
  },
  password: { 
    type: String, 
    required: true, 
    select: false 
  },
  role: { 
    type: String, 
    enum: ['rider', 'driver', 'superadmin'], 
    default: 'rider' 
  },
  
  // --- INFOS CHAUFFEUR ---
  vehicle: {
    brand: String,
    model: String,
    plate: String,
    color: String,
    type: { type: String, enum: ['ECHO', 'STANDARD', 'VIP'], default: 'STANDARD' }
  },
  
  isAvailable: { 
    type: Boolean, 
    default: false 
  },
  
  // 🚀 STATS DE PERFORMANCE DYNAMIQUE (DASHBOARD)
  totalRides: { 
    type: Number, 
    default: 0 
  },
  totalEarnings: { 
    type: Number, 
    default: 0 
  },
  rating: { 
    type: Number, 
    default: 5.0 
  },
  
  subscription: {
    isActive: { type: Boolean, default: false },
    plan: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
    expiresAt: Date
  },

  // Géolocalisation
  currentLocation: {
    type: { type: String, default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
  },
  
  lastLocationAt: Date,
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Indexation pour la recherche de proximité
userSchema.index({ currentLocation: '2dsphere' });

// Middleware de hachage du mot de passe
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Méthode de vérification
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);