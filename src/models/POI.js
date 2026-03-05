// src/models/POI.js
// MODÈLE DE BASE DE DONNÉES - Points d'Intérêt (Lieux)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Un lieu doit avoir un nom'],
      trim: true,
      unique: true,
    },
    latitude: {
      type: Number,
      required: [true, 'La latitude est obligatoire'],
    },
    longitude: {
      type: Number,
      required: [true, 'La longitude est obligatoire'],
    },
    icon: {
      type: String,
      default: 'location',
    },
    iconColor: {
      type: String,
      default: '#D4AF37', // Or Champagne par défaut
    },
    isActive: {
      type: Boolean,
      default: true, // Permet de désactiver un lieu sans le supprimer définitivement
    },
    // AJOUTS SENIOR : Système de file d'attente (Pending State)
    pendingAction: {
      type: String,
      enum: ['NONE', 'UPDATE', 'DELETE'],
      default: 'NONE',
    },
    pendingData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    }
  },
  {
    timestamps: true, // Ajoute automatiquement createdAt et updatedAt
  }
);

const POI = mongoose.model('POI', poiSchema);

module.exports = POI;