// src/routes/orderRoutes.js
// ROUTES COMMANDES - Flux Marketplace

const express = require('express');
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Routes Client (Passager)
router.post('/', authorize('rider'), orderController.createOrder);
router.get('/my-orders', authorize('rider'), orderController.getMyOrders);

// Routes Vendeur
router.get('/seller-orders', authorize('seller', 'admin'), orderController.getSellerOrders);

// Action de statut (Vendeur / Livreur)
router.patch('/:id/status', authorize('rider', 'seller', 'driver', 'admin'), orderController.updateOrderStatus);

module.exports = router;
