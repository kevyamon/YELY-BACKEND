// src/models/Transaction.js
// MODELE TRANSACTION - Audit Grade & Tracabilite Multi-Admin
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
  senderPhone: { 
    type: String, 
    required: true 
  },
  proofUrl: { 
    type: String, 
    required: true 
  },
  proofPublicId: { 
    type: String, 
    required: true 
  },
  collectorType: { 
    type: String, 
    enum: ['SUPERADMIN', 'PARTNER'], 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'APPROVED', 'REJECTED'], 
    default: 'PENDING',
    index: true
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

// Index pour les recherches de performance admin
transactionSchema.index({ status: 1, assignedTo: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);