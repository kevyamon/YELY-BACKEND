// src/models/TokenBlacklist.js
// MODÈLE BLACKLIST - Nettoyage automatique (TTL)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: { 
    type: String, 
    required: true, 
    unique: true, // Index unique pour performance et éviter doublons
    index: true 
  },
  // Le champ qui sert de timer pour la suppression auto
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 604800 // 7 jours en secondes (doit être >= durée du Refresh Token)
  }
});

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);