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
    const { category, seller, search, popular, limit } = req.query;
    const query = { isActive: true };

    if (category) query.category = category;
    if (seller) {
      query.seller = seller;
    } else if (req.user) {
      // Exclure les propres produits du vendeur connecté
      query.seller = { $ne: req.user._id };
    }
    if (search) {
      const cleanSearch = search.trim();
      const lowerSearch = cleanSearch.toLowerCase();
      
      // Mappage intelligent pour faire correspondre les recherches de catégories en Français
      const CATEGORY_MAP = {
        'nourriture': 'Food',
        'food': 'Food',
        'resto': 'Food',
        'restaurant': 'Food',
        'plat': 'Food',
        'repas': 'Food',
        'manger': 'Food',
        'supermarche': 'Supermarket',
        'supermarché': 'Supermarket',
        'epicerie': 'Supermarket',
        'épicerie': 'Supermarket',
        'courses': 'Supermarket',
        'panier': 'Supermarket',
        'cosmetique': 'Cosmetics',
        'cosmétique': 'Cosmetics',
        'beaute': 'Cosmetics',
        'beauté': 'Cosmetics',
        'soins': 'Cosmetics',
        'maquillage': 'Cosmetics',
        'electronique': 'Electronics',
        'électronique': 'Electronics',
        'hightech': 'Electronics',
        'high-tech': 'Electronics',
        'telephone': 'Electronics',
        'téléphone': 'Electronics',
        'pc': 'Electronics',
        'maison': 'Home',
        'deco': 'Home',
        'déco': 'Home',
        'decoration': 'Home',
        'décoration': 'Home',
        'entretien': 'Home'
      };

      const matchedCategory = CATEGORY_MAP[lowerSearch];

      query.$or = [
        { name: { $regex: cleanSearch, $options: 'i' } },
        { description: { $regex: cleanSearch, $options: 'i' } }
      ];

      // Si le mot clé correspond à une catégorie, on l'ajoute dans le match $or
      if (matchedCategory) {
        query.$or.push({ category: matchedCategory });
      }
    }

    let queryBuilder = Product.find(query).populate('seller', 'name profilePicture rating');

    if (popular === 'true') {
      queryBuilder = queryBuilder.sort('-salesCount -rating');
    } else {
      queryBuilder = queryBuilder.sort('-createdAt');
    }

    if (limit) {
      queryBuilder = queryBuilder.limit(parseInt(limit, 10));
    }

    const products = await queryBuilder;

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
 * @desc    Récupérer les produits du vendeur connecté
 */
exports.getMyProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ seller: req.user._id })
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
    
    // Gestion automatique du stock selon la catégorie (La nourriture n'a pas de stock)
    if (req.body.category === 'Food') {
      req.body.manageStock = false;
      req.body.stockCount = 0;
      req.body.isSoldOut = false;
    } else {
      if (req.body.stockCount !== undefined) {
        const count = Math.max(0, parseInt(req.body.stockCount, 10) || 0);
        req.body.stockCount = count;
        req.body.manageStock = true;
        req.body.isSoldOut = count === 0;
      }
    }
    
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

    if (imageUrls.length === 0) {
      return next(new AppError('Au moins une image de produit est obligatoire.', 400));
    }

    // Le backend supporte 'image' (unique) et 'images' (tableau) pour la compatibilité
    req.body.images = imageUrls;
    req.body.image = imageUrls[0]; // Image principale

    const product = await Product.create(req.body);
    const populatedProduct = await Product.findById(product._id).populate('seller', 'name profilePicture rating');
    
    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) {
      io.emit('product_created', populatedProduct);
    }

    logger.info(`[MARKETPLACE] Nouveau produit créé par ${req.user.email}: ${product.name}`);

    res.status(201).json({
      success: true,
      data: populatedProduct
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
        try {
          const result = await cloudinary.uploader.upload(file.path, {
            folder: 'yely/products',
          });
          newImageUrls.push(result.secure_url);
        } catch (uploadErr) {
          logger.error(`[CLOUDINARY] Upload error: ${uploadErr.message}`);
        } finally {
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
      }
    }

    // Fusionner avec les images existantes conservées
    let existingImages = req.body.existingImages || [];
    if (typeof existingImages === 'string') {
      existingImages = [existingImages];
    } else if (!Array.isArray(existingImages)) {
      existingImages = []; 
    }
    
    const finalImages = [...existingImages, ...newImageUrls];

    if (finalImages.length === 0) {
      return next(new AppError('Au moins une image de produit est obligatoire.', 400));
    }

    // Nettoyage de req.body pour ne garder que les champs du schéma
    const updateData = { ...req.body };
    delete updateData.existingImages;
    delete updateData.images; // On a déjà finalImages
    
    updateData.images = finalImages;
    updateData.image = finalImages[0];

    // Gestion automatique du stock selon la catégorie (La nourriture n'a pas de stock)
    if (updateData.category === 'Food' || (updateData.category === undefined && product && product.category === 'Food')) {
      updateData.manageStock = false;
      updateData.stockCount = 0;
      updateData.isSoldOut = false;
    } else {
      if (updateData.stockCount !== undefined) {
        const count = Math.max(0, parseInt(updateData.stockCount, 10) || 0);
        updateData.stockCount = count;
        updateData.manageStock = true;
        updateData.isSoldOut = count === 0;
      }
    }

    if (process.env.NODE_ENV === 'development') logger.info(`[MARKETPLACE] Updating product ${req.params.id} with:`, updateData);

    product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    }).populate('seller', 'name profilePicture rating');

    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) io.emit('product_updated', product);

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
    
    const populatedProduct = await Product.findById(product._id).populate('seller', 'name profilePicture rating');

    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) io.emit('product_updated', populatedProduct);

    res.status(200).json({
      success: true,
      data: populatedProduct
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

    const productId = product._id;
    await product.deleteOne();

    // TEMPS RÉEL
    const io = req.app.get('socketio');
    if (io) io.emit('product_deleted', productId);

    res.status(200).json({
      success: true,
      message: 'Produit supprimé avec succès'
    });
  } catch (error) {
    next(error);
  }
};
