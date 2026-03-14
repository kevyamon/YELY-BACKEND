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
    // Le validateur enum a ete retire pour permettre le routage dynamique (Deep Linking)
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

// Index de purge automatique (optionnel) : supprimer apres 90 jours
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

module.exports = mongoose.model('Notification', notificationSchema);