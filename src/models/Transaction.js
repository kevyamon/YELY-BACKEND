// src/models/Transaction.js
// MODELE TRANSACTION - Audit Grade & Intégrité Financière (Automatisé & Passerelle)
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  planId: { 
    type: String, 
    enum: ['WEEKLY', 'MONTHLY'], 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'], 
    default: 'PENDING',
    index: true
  },

  // IDENTIFIANTS PASSERELLE DE PAIEMENT AUTOMATIQUE
  paymentReference: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  gateway: {
    type: String,
    default: 'GENIUSPAY'
  },
  gatewayTransactionId: {
    type: String,
    sparse: true,
    index: true
  },
  operator: {
    type: String, // ex: 'WAVE', 'ORANGE', 'MTN', 'MOOV', 'CARD'
    default: 'GENIUSPAY'
  },
  customerPhone: {
    type: String
  },
  paymentUrl: {
    type: String
  },
  completedAt: {
    type: Date
  },

  // CHAMPS DE RÉTRO-COMPATIBILITÉ (ANCIEN FLUX MANUEL)
  senderPhone: { 
    type: String 
  },
  proofUrl: { 
    type: String 
  },
  proofPublicId: { 
    type: String 
  },
  collectorType: { 
    type: String, 
    enum: ['SUPERADMIN', 'PARTNER'] 
  },
  assignedTo: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    index: true
  },
  rejectionReason: {
    type: String
  },
  auditLog: [{
    action: String,
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    note: String
  }]
}, { 
  timestamps: true 
});

// Index composites pour les recherches de performance admin et rapports fiscaux
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ gateway: 1, status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);