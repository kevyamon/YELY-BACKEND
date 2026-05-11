// src/models/Ledger.js
// MODÈLE LEDGER - Ardoise de Dettes & Réconciliation Cash
// STANDARD: Audit Trail (Intégrité Financière)

const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    comment: 'Montant des produits collecté par le livreur pour le vendeur'
  },
  status: {
    type: String,
    enum: ['pending', 'cleared'],
    default: 'pending',
    index: true,
    comment: 'pending: dette active; cleared: vendeur a confirmé réception du cash'
  },
  clearedAt: {
    type: Date,
    default: null
  },
  
  // Note pour la réconciliation
  note: String
}, {
  timestamps: true
});

// Index composite pour retrouver rapidement les dettes entre un livreur et un vendeur spécifique
ledgerSchema.index({ driver: 1, seller: 1, status: 1 });

const Ledger = mongoose.models.Ledger || mongoose.model('Ledger', ledgerSchema);

module.exports = Ledger;
