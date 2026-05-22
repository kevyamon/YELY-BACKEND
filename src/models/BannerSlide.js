// src/models/BannerSlide.js
// MODÈLE BANNIÈRE PROMO - Carrousel Marketplace en Temps Réel
// STANDARD: Industriel (Haute Disponibilité)

const mongoose = require('mongoose');

const bannerSlideSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true,
    maxlength: [80, 'Le titre ne peut pas dépasser 80 caractères']
  },
  body: {
    type: String,
    maxlength: [200, 'La description ne peut pas dépasser 200 caractères']
  },
  image: {
    type: String
  },
  badge: {
    type: String,
    default: 'NOUVEAU',
    maxlength: [20, 'Le badge ne peut pas dépasser 20 caractères']
  },
  layoutType: {
    type: String,
    enum: {
      values: ['standard', 'background'],
      message: 'Type de disposition non supporté : {VALUE}'
    },
    default: 'standard'
  },
  mediaType: {
    type: String,
    enum: {
      values: ['image', 'video'],
      message: 'Type de média non supporté : {VALUE}'
    },
    default: 'image'
  },
  video: {
    type: String
  },
  displayDuration: {
    type: Number,
    default: null
  },
  ctaType: {
    type: String,
    enum: {
      values: ['none', 'external', 'internal'],
      message: 'Type de redirection non supporté : {VALUE}'
    },
    default: 'none'
  },
  ctaUrl: {
    type: String
  },
  ctaRoute: {
    type: String
  },
  ctaRouteParams: {
    type: String
  },
  ctaLabel: {
    type: String,
    default: 'Voir plus',
    maxlength: [30, 'Le libellé ne peut pas dépasser 30 caractères']
  },
  animationType: {
    type: String,
    enum: {
      values: ['none', 'bubbles', 'confetti', 'stars'],
      message: 'Type d\'animation non supporté : {VALUE}'
    },
    default: 'none'
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexation pour les requêtes rapides du hub
bannerSlideSchema.index({ isActive: 1, order: 1 });

const BannerSlide = mongoose.models.BannerSlide || mongoose.model('BannerSlide', bannerSlideSchema);

module.exports = BannerSlide;
