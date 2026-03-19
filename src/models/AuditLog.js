// src/models/AuditLog.js
// BOÎTE NOIRE - Traçabilité Bancaire
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  action: { 
    type: String, 
    required: true,
    // On élargit l'enum pour autoriser toutes les actions du système Admin
    enum: [
      'PROMOTE_USER', 
      'REVOKE_USER', 
      'BAN_USER', 
      'UNBAN_USER', 
      'UPDATE_SETTINGS',
      'UPDATE_MAP_SETTINGS',
      'APPROVE_TRANSACTION', 
      'REJECT_TRANSACTION',
      'APPROVE_SUBSCRIPTION',
      'REJECT_SUBSCRIPTION',
      'TOGGLE_PROMO',
      'UPDATE_WAVE_LINKS'
    ]
  },
  target: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', // ou Transaction, selon le contexte
    required: false
  },
  details: { 
    type: String, 
    required: true 
  },
  ip: { 
    type: String, 
    default: '0.0.0.0' 
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed, // Pour stocker l'ancien rôle, la raison, etc.
    default: {}
  }
}, { 
  timestamps: { createdAt: true, updatedAt: false } // On ne modifie jamais un log
});

// Index pour recherche rapide par acteur ou par date
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });

// INDEX TTL : Purge automatique des logs après 60 jours (5184000 secondes) pour préserver le stockage MongoDB
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 5184000 });

module.exports = mongoose.model('AuditLog', auditLogSchema);