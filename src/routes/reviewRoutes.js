// src/routes/reviewRoutes.js
// ROUTES AVIS & NOTATIONS - Enregistrement des retours clients
// CSCSM Level: Bank Grade

const express = require('express');
const reviewController = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Route publique pour lire les avis d'un produit
router.get('/product/:productId', reviewController.getProductReviews);

// Sécurisation globale par le JWT (Iron Dome) pour l'écriture
router.use(protect);

router.post('/', reviewController.createReview);
router.patch('/:id', reviewController.updateReview);
router.delete('/:id', reviewController.deleteReview);

module.exports = router;
