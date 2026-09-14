// src/models/POI.js
// MODÈLE DE BASE DE DONNÉES - Points d'Intérêt & Boutiques (Support Multi-Boutiques / Immeubles)
// CSCSM Level: Bank Grade (Modularisé < 325 lignes, Sans Emojis)

const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Un lieu doit avoir un nom'],
      trim: true,
      index: true,
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
      default: 'Ionicons/location',
    },
    iconColor: {
      type: String,
      default: '#D4AF37', 
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['LANDMARK', 'SHOP'],
      default: 'LANDMARK',
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    isSuggested: {
      type: Boolean,
      default: false,
    },
    suggestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
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
    timestamps: true, 
  }
);

poiSchema.index({ latitude: 1, longitude: 1 });

const POI = mongoose.model('POI', poiSchema);

module.exports = POI;