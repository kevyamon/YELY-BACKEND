// src/models/Claim.js
// MODELE RECLAMATION - Tracabilite des primes d'acquisition
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema({
  agent: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Agent', 
    required: true,
    index: true
  },
  clientPhone: { 
    type: String, 
    required: true,
    unique: true // Un numero ne peut etre reclame qu'une seule fois
  },
  clientUser: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  clientRole: { 
    type: String, 
    enum: ['rider', 'driver'], 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['VALIDATED', 'REJECTED'], 
    default: 'VALIDATED' 
  }
}, { 
  timestamps: true 
});

/**
 * INDEX TTL (Time To Live)
 * Supprime automatiquement le document 7 jours après sa création.
 * 7 jours = 604800 secondes.
 */
claimSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('Claim', claimSchema);