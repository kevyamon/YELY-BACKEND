// src/models/Product.js
// MODÈLE PRODUIT - Catalogue Marketplace
// STANDARD: Industriel (Haute Disponibilité)

const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Le vendeur est obligatoire']
  },
  name: {
    type: String,
    required: [true, 'Le nom du produit est obligatoire'],
    trim: true,
    maxlength: [100, 'Le nom ne peut dépasser 100 caractères']
  },
  description: {
    type: String,
    required: [true, 'La description est obligatoire'],
    maxlength: [1000, 'La description est trop longue']
  },
  price: {
    type: Number,
    required: [true, 'Le prix est obligatoire'],
    min: [0, 'Le prix ne peut être négatif']
  },
  category: {
    type: String,
    required: [true, 'La catégorie est obligatoire'],
    enum: {
      values: ['Food', 'Cosmetics', 'Electronics', 'Home', 'Supermarket', 'Other'],
      message: 'Catégorie {VALUE} non supportée'
    },
    default: 'Other'
  },
  images: [{
    type: String,
    default: []
  }],
  
  // Gestion des stocks "Marmite" ou chiffrée
  manageStock: {
    type: Boolean,
    default: false // Par défaut, on utilise juste le flag isSoldOut
  },
  stockCount: {
    type: Number,
    default: 0,
    min: 0
  },
  isSoldOut: {
    type: Boolean,
    default: false,
    index: true
  },

  // Statistiques & Visibilité
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  rating: {
    type: Number,
    default: 5.0
  },
  numReviews: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index pour la recherche rapide
productSchema.index({ seller: 1, category: 1 });
productSchema.index({ name: 'text', description: 'text' });

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

module.exports = Product;
