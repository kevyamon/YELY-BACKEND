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
    let productId = req.body.productId || req.body.product;
    const { rating, comment } = req.body;
    const userId = req.user._id;

    if (productId && typeof productId === 'object') {
      productId = productId._id || productId.id;
    }

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError('Identifiant de produit invalide.', 400);
    }

    if (rating === undefined || rating === null) {
      throw new AppError('La note est obligatoire.', 400);
    }
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      throw new AppError('La note doit être un nombre entier compris entre 1 et 5.', 400);
    }

    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      throw new AppError('Le commentaire est obligatoire et ne peut pas être vide.', 400);
    }
    const trimmedComment = comment.trim();
    if (trimmedComment.length > 5000) {
      throw new AppError('Le commentaire ne peut dépasser 5000 caractères.', 400);
    }

    const productObjectId = new mongoose.Types.ObjectId(productId);

    // 1. Vérifier si l'utilisateur a commandé ce produit et si le statut est 'delivered'
    const order = await Order.findOne({
      customer: userId,
      status: 'delivered',
      'items.product': productObjectId
    });

    if (!order) {
      throw new AppError('Vous ne pouvez noter que les produits que vous avez achetés et reçus.', 403);
    }

    // 2. Vérifier si un avis existe déjà pour ce produit
    const existingReview = await Review.findOne({ product: productObjectId, user: userId });
    if (existingReview) {
      throw new AppError('Vous avez déjà laissé un avis pour ce produit.', 400);
    }

    // 3. Créer l'avis
    const review = await Review.create({
      product: productObjectId,
      user: userId,
      rating: numRating,
      comment: trimmedComment
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

    if (rating !== undefined && rating !== null) {
      const numRating = Number(rating);
      if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
        throw new AppError('La note doit être un nombre entier compris entre 1 et 5.', 400);
      }
      review.rating = numRating;
    }

    if (comment !== undefined && comment !== null) {
      if (typeof comment !== 'string' || !comment.trim()) {
        throw new AppError('Le commentaire ne peut pas être vide.', 400);
      }
      const trimmedComment = comment.trim();
      if (trimmedComment.length > 5000) {
        throw new AppError('Le commentaire ne peut dépasser 5000 caractères.', 400);
      }
      review.comment = trimmedComment;
    }

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

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError('Identifiant de produit invalide.', 400);
    }

    const reviews = await Review.find({ product: new mongoose.Types.ObjectId(productId) })
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
