// src/routes/bannerRoutes.js
// ROUTES BANNIÈRES - Gestion du Carrousel Marketplace
// STANDARD: Industriel (Rôle strict & Signature Securisée)

const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { uploadBannerImage, validateFileSignature } = require('../middleware/uploadMiddleware');

// Route publique : Récupérer les bannières actives
router.get('/', bannerController.getActiveBanners);

// Routes d'administration - Réservées au rôle SuperAdmin
router.use(protect);
router.use(authorize('superadmin'));

router.get('/admin', bannerController.getAllBannersAdmin);

router.post(
  '/', 
  uploadBannerImage,
  validateFileSignature,
  bannerController.createBanner
);

router.patch(
  '/:id', 
  uploadBannerImage,
  validateFileSignature,
  bannerController.updateBanner
);

router.patch(
  '/:id/toggle', 
  bannerController.toggleBannerStatus
);

router.delete(
  '/:id', 
  bannerController.deleteBanner
);

module.exports = router;
