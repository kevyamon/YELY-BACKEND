// src/routes/subscriptionRoutes.js
// ROUTES SOUSCRIPTION - Paiement Automatisé & Webhooks Forteresse
// STANDARD: Industriel / Bank Grade

const express = require('express');
const router = express.Router();
const {
  getConfig,
  getStatus,
  initializePayment,
  handleWebhook,
  verifyPayment
} = require('../controllers/subscriptionController');
const { protect, authorize } = require('../middleware/authMiddleware');

/**
 * @route   GET /api/v1/subscriptions/config
 * @desc    Récupération sécurisée des prix calculés (Pionnier / Promo / Standard)
 */
router.get(
  '/config',
  protect,
  getConfig
);

/**
 * @route   GET /api/v1/subscriptions/status
 * @desc    Récupération de l'état d'abonnement en temps réel
 */
router.get(
  '/status',
  protect,
  getStatus
);

/**
 * @route   POST /api/v1/subscriptions/initialize
 * @desc    Initialisation d'une session de paiement automatique GeniusPay
 */
router.post(
  '/initialize',
  protect,
  authorize('driver', 'seller', 'admin', 'superadmin'),
  initializePayment
);

/**
 * @route   GET /api/v1/subscriptions/verify/:reference
 * @desc    Vérification / Synchronisation active d'une transaction
 */
router.get(
  '/verify/:reference',
  protect,
  verifyPayment
);

/**
 * @route   POST /api/v1/subscriptions/webhook
 * @desc    Endpoint public sécurisé recevant les notifications de paiement GeniusPay
 * Note: Authentifié par signature cryptographique HMAC-SHA256
 */
router.post(
  '/webhook',
  handleWebhook
);

module.exports = router;