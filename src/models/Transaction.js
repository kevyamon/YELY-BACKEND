// src/models/Transaction.js
// MODÈLE TRANSACTION - Bank Grade & Haute Performance (Index & Contraintes)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // 🛡️ SÉCURITÉ : Contrainte financière absolue pour éviter les falsifications
  amount: { 
    type: Number, 
    required: true,
    min: [1, 'Le montant doit être strictement positif'] 
  },
  
  type: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true },
  
  // 🚀 PERFORMANCE : Index pour la rapidité d'affichage du Dashboard Admin
  status: { 
    type: String, 
    enum: ['PENDING', 'APPROVED', 'REJECTED'], 
    default: 'PENDING',
    index: true 
  },
  
  // Isolation financière avec Index
  assignedTo: { 
    type: String, 
    enum: ['SUPERADMIN', 'PARTNER'], 
    required: true,
    index: true 
  },
  
  // Preuve Cloudinary
  proofImageUrl: String,
  proofPublicId: String, 
  
  senderPhone: String,
  rejectionReason: String,
  
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// 🚀 PERFORMANCE : Index composé pour optimiser au maximum la file d'attente (getValidationQueue)
transactionSchema.index({ status: 1, assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);