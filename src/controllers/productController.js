// src/controllers/productController.js
// CONTROLLER PRODUITS - Gestion du Catalogue Marketplace
// STANDARD: Industriel (Validation strict & Performance)

const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * @desc    Récupérer tous les produits (avec filtres optionnels)
 * @route   GET /api/v1/products
 * @access  Public
 */
exports.getAllProducts = async (req, res, next) => {
  try {
    const { category, seller, search } = req.query;
    const query = { isActive: true };

    if (category) query.category = category;
    if (seller) query.seller = seller;
    if (search) {
      query.$text = { $search: search };
    }

    const products = await Product.find(query)
      .populate('seller', 'name profilePicture rating')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Récupérer un produit par ID
 * @route   GET /api/v1/products/:id
 * @access  Public
 */
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('seller', 'name profilePicture rating');

    if (!product) {
      return next(new AppError('Produit introuvable', 404));
    }

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Créer un produit
 * @route   POST /api/v1/products
 * @access  Private (Seller/Admin)
 */
exports.createProduct = async (req, res, next) => {
  try {
    // Force le vendeur à être l'utilisateur connecté
    req.body.seller = req.user._id;

    const product = await Product.create(req.body);

    logger.info(`[MARKETPLACE] Nouveau produit créé par ${req.user.email}: ${product.name}`);

    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mettre à jour un produit
 * @route   PATCH /api/v1/products/:id
 * @access  Private (Owner Seller/Admin)
 */
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return next(new AppError('Produit introuvable', 404));
    }

    // Vérifier la propriété (sauf si admin)
    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Vous n\'êtes pas autorisé à modifier ce produit', 403));
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Basculer l'état "Rupture de stock"
 * @route   PATCH /api/v1/products/:id/toggle-sold-out
 * @access  Private (Owner Seller)
 */
exports.toggleSoldOut = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new AppError('Produit introuvable', 404));
    }

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Non autorisé', 403));
    }

    product.isSoldOut = !product.isSoldOut;
    await product.save();

    res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Supprimer un produit (Soft Delete recommandé mais ici Hard Delete pour rester simple)
 * @route   DELETE /api/v1/products/:id
 * @access  Private (Owner Seller/Admin)
 */
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new AppError('Produit introuvable', 404));
    }

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Non autorisé', 403));
    }

    await product.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Produit supprimé avec succès'
    });
  } catch (error) {
    next(error);
  }
};
