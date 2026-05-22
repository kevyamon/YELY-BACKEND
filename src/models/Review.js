// src/models/Review.js
// MODÈLE AVIS & NOTATIONS - E-commerce Yély
// STANDARD: Bank Grade (Intégrité des Données)

const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Le produit est obligatoire']
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, "L'utilisateur est obligatoire"]
  },
  rating: {
    type: Number,
    required: [true, 'La note est obligatoire'],
    min: [1, 'La note minimale est 1'],
    max: [5, 'La note maximale est 5']
  },
  comment: {
    type: String,
    required: [true, 'Le commentaire est obligatoire'],
    maxlength: [5000, 'Le commentaire ne peut dépasser 5000 caractères']
  }
}, {
  timestamps: true
});

// Empêche un utilisateur de laisser plusieurs avis sur un même produit
reviewSchema.index({ product: 1, user: 1 }, { unique: true });

const Review = mongoose.models.Review || mongoose.model('Review', reviewSchema);

module.exports = Review;
