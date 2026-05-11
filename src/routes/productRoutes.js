// src/routes/productRoutes.js
// ROUTES PRODUITS - Catalogue & Gestion Vendeur

const express = require('express');
const productController = require('../controllers/productController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Routes publiques
router.get('/', productController.getAllProducts);
router.get('/:id', productController.getProduct);

// Routes protégées (Vendeurs & Admins)
router.use(protect);

router.post(
  '/', 
  authorize('seller', 'admin'), 
  productController.createProduct
);

router.patch(
  '/:id', 
  authorize('seller', 'admin'), 
  productController.updateProduct
);

router.patch(
  '/:id/toggle-sold-out', 
  authorize('seller', 'admin'), 
  productController.toggleSoldOut
);

router.delete(
  '/:id', 
  authorize('seller', 'admin'), 
  productController.deleteProduct
);

module.exports = router;
