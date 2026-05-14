// src/controllers/productController.js
// CONTROLLER PRODUITS - Gestion du Catalogue Marketplace
// STANDARD: Industriel (Validation strict & Performance)

const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * @desc    Récupérer tous les produits (avec filtres optionnels)
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
 */
exports.createProduct = async (req, res, next) => {
  try {
    req.body.seller = req.user._id;
    
    // Gestion des images
    const imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/products',
          resource_type: 'auto'
        });
        imageUrls.push(result.secure_url);
        // Supprimer le fichier temporaire
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    // Le backend supporte 'image' (unique) et 'images' (tableau) pour la compatibilité
    if (imageUrls.length > 0) {
      req.body.images = imageUrls;
      req.body.image = imageUrls[0]; // Image principale
    }

    const product = await Product.create(req.body);
    logger.info(`[MARKETPLACE] Nouveau produit créé par ${req.user.email}: ${product.name}`);

    res.status(201).json({
      success: true,
      data: product
    });
  } catch (error) {
    // Nettoyage en cas d'erreur
    if (req.files) {
      req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    }
    next(error);
  }
};

/**
 * @desc    Mettre à jour un produit
 */
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);
    if (!product) return next(new AppError('Produit introuvable', 404));

    if (product.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Non autorisé', 403));
    }

    // Gestion des nouvelles images
    const newImageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/products',
        });
        newImageUrls.push(result.secure_url);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    // Fusionner avec les images existantes conservées
    let existingImages = req.body.existingImages || [];
    if (typeof existingImages === 'string') existingImages = [existingImages];
    
    const finalImages = [...existingImages, ...newImageUrls];
    if (finalImages.length > 0) {
      req.body.images = finalImages;
      req.body.image = finalImages[0];
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
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
