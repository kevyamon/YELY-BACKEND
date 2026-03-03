// src/models/Transaction.js
// MODELE TRANSACTION - Bank Grade & Haute Performance (Index & Contraintes)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  
  // SECURITE : Contrainte financiere absolue pour eviter les falsifications
  amount: { 
    type: Number, 
    required: true,
    min: [1, 'Le montant doit etre strictement positif'] 
  },
  
  type: { type: String, enum: ['WEEKLY', 'MONTHLY'], required: true },
  
  // PERFORMANCE : Index pour la rapidite d'affichage du Dashboard Admin
  status: { 
    type: String, 
    enum: ['PENDING', 'APPROVED', 'REJECTED'], 
    default: 'PENDING',
    index: true 
  },
  
  // Isolation financiere avec Index
  assignedTo: { 
    type: String, 
    enum: ['SUPERADMIN', 'ADMIN'], 
    required: true,
    index: true 
  },
  
  // Preuve Cloudinary
  proofImageUrl: String,
  proofPublicId: String, 
  
  senderPhone: String,
  rejectionReason: String,
  
  // Tracabilite et Override (Surclassement)
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  intendedFor: { type: String, enum: ['SUPERADMIN', 'ADMIN'] }
}, { timestamps: true });

// PERFORMANCE : Index compose pour optimiser au maximum la file d'attente
transactionSchema.index({ status: 1, assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);