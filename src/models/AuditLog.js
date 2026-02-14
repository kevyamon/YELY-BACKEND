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
    enum: ['PROMOTE_USER', 'REVOKE_USER', 'BAN_USER', 'UNBAN_USER', 'UPDATE_SETTINGS', 'APPROVE_TRANSACTION', 'REJECT_TRANSACTION']
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

module.exports = mongoose.model('AuditLog', auditLogSchema);