// src/controllers/reviewController.js
// CONTROLEUR AVIS & NOTATIONS - Gestion des retours clients
// CSCSM Level: Bank Grade

const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/responseHandler');
const mongoose = require('mongoose');

// Helper pour recalculer la note moyenne d'un produit
const updateProductRating = async (productId) => {
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    {
      $group: {
        _id: '$product',
        nRatings: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);
  
  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      rating: Math.round(stats[0].avgRating * 10) / 10,
      numReviews: stats[0].nRatings
    });
  } else {
    await Product.findByIdAndUpdate(productId, {
      rating: 5.0,
      numReviews: 0
    });
  }
};

// Créer un avis
const createReview = async (req, res, next) => {
  try {
    const productId = req.body.productId || req.body.product;
    const { rating, comment } = req.body;
    const userId = req.user._id;

    // 1. Vérifier si l'utilisateur a commandé ce produit et si le statut est 'delivered'
    const order = await Order.findOne({
      customer: userId,
      status: 'delivered',
      'items.product': productId
    });

    if (!order) {
      throw new AppError('Vous ne pouvez noter que les produits que vous avez achetés et reçus.', 403);
    }

    // 2. Vérifier si un avis existe déjà pour ce produit
    const existingReview = await Review.findOne({ product: productId, user: userId });
    if (existingReview) {
      throw new AppError('Vous avez déjà laissé un avis pour ce produit.', 400);
    }

    // 3. Créer l'avis
    const review = await Review.create({
      product: productId,
      user: userId,
      rating,
      comment
    });

    // 4. Recalculer la note moyenne du produit
    await updateProductRating(productId);

    return successResponse(res, review, 'Avis enregistré avec succès', 201);
  } catch (error) {
    return next(error);
  }
};

// Mettre à jour son propre avis
const updateReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    const reviewId = req.params.id;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      throw new AppError('Avis introuvable.', 404);
    }

    if (review.user.toString() !== userId.toString()) {
      throw new AppError("Vous n'êtes pas autorisé à modifier cet avis.", 403);
    }

    review.rating = rating || review.rating;
    review.comment = comment || review.comment;
    await review.save();

    // Recalculer la note moyenne du produit
    await updateProductRating(review.product);

    return successResponse(res, review, 'Avis mis à jour avec succès');
  } catch (error) {
    return next(error);
  }
};

// Supprimer son propre avis
const deleteReview = async (req, res, next) => {
  try {
    const reviewId = req.params.id;
    const userId = req.user._id;

    const review = await Review.findById(reviewId);
    if (!review) {
      throw new AppError('Avis introuvable.', 404);
    }

    if (review.user.toString() !== userId.toString()) {
      throw new AppError("Vous n'êtes pas autorisé à supprimer cet avis.", 403);
    }

    const productId = review.product;
    await review.deleteOne();

    // Recalculer la note moyenne du produit
    await updateProductRating(productId);

    return successResponse(res, null, 'Avis supprimé avec succès');
  } catch (error) {
    return next(error);
  }
};

// Récupérer tous les avis d'un produit (public)
const getProductReviews = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const reviews = await Review.find({ product: productId })
      .populate('user', 'name profilePicture')
      .sort({ createdAt: -1 });

    return successResponse(res, reviews, 'Avis récupérés avec succès');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createReview,
  updateReview,
  deleteReview,
  getProductReviews
};
