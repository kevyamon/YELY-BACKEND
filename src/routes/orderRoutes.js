// src/routes/orderRoutes.js
// ROUTES COMMANDES - Flux Marketplace

const express = require('express');
const orderController = require('../controllers/orderController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Routes Client (Passager/Shopper)
router.post('/', authorize('client', 'seller', 'rider', 'driver', 'admin'), orderController.createOrder);
router.get('/my-orders', authorize('client', 'seller', 'rider', 'driver', 'admin'), orderController.getMyOrders);
router.patch('/:id/cancel', authorize('client', 'seller', 'rider', 'driver', 'admin'), orderController.cancelOrder);

// Routes Vendeur
router.get('/seller-orders', authorize('seller', 'admin'), orderController.getSellerOrders);

// Route générique ID (toujours en dernier)
router.get('/:id', orderController.getOrder);

// Action de statut (Vendeur / Livreur)
router.patch('/:id/status', authorize('rider', 'seller', 'driver', 'admin'), orderController.updateOrderStatus);

module.exports = router;
