// src/models/Report.js
// MODELE REPORT - Signalements avec Auto-Nettoyage
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true, maxlength: 2000 },
  captures: [{ type: String }], 
  status: { type: String, enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED'], default: 'OPEN' },
  adminNote: { type: String, default: '' },
  deletedByUser: { type: Boolean, default: false },
  deletedByAdmin: { type: Boolean, default: false }
}, { timestamps: true });

// Index de purge automatique : supprimer apres 15 jours (1296000 secondes)
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1296000 });

module.exports = mongoose.model('Report', reportSchema);