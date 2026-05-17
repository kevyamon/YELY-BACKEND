// src/models/BannerSlide.js
// MODÈLE BANNIÈRE PROMO - Carrousel Marketplace en Temps Réel
// STANDARD: Industriel (Haute Disponibilité)

const mongoose = require('mongoose');

const bannerSlideSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Le titre de la news est obligatoire'],
    trim: true,
    maxlength: [80, 'Le titre ne peut pas dépasser 80 caractères']
  },
  body: {
    type: String,
    required: [true, 'Le texte descriptif est obligatoire'],
    maxlength: [200, 'La description ne peut pas dépasser 200 caractères']
  },
  image: {
    type: String,
    required: [true, 'L\'image de la bannière est obligatoire']
  },
  badge: {
    type: String,
    default: 'NOUVEAU',
    maxlength: [20, 'Le badge ne peut pas dépasser 20 caractères']
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
