// src/models/Notification.js
// MODELE NOTIFICATION - Persistance des alertes utilisateur
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    default: 'SYSTEM'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: { type: Boolean, default: false, index: true }
}, { 
  timestamps: { createdAt: true, updatedAt: false } 
});

// Index de purge automatique : supprimer apres 30 jours (2592000 secondes)
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model('Notification', notificationSchema);