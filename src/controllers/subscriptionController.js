// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration Passerelle GeniusPay & Webhooks Sécurisés
// STANDARD: Industriel / Bank Grade (HMAC-SHA256, Idempotence & Zero Client Trust)

const subscriptionService = require('../services/subscriptionService');
const geniusPayService = require('../services/geniusPayService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const DEMO_PHONES = ['0100000001', '0100000002', '0100000003', '+2250100000001', '+2250100000002', '+2250100000003'];

/**
 * Récupère la configuration tarifaire dynamique (Pionnier / Promo / Standard)
 */
const getConfig = async (req, res, next) => {
  try {
    const userId = req.user ? req.user._id : null;
    const config = await subscriptionService.getSubscriptionPricing(userId);
    const settings = await Settings.findOne();

    const enrichedConfig = {
      ...config,
      isGlobalFreeAccess: settings?.isGlobalFreeAccess || false,
      promoMessage: settings?.promoMessage || ""
    };

    return successResponse(res, enrichedConfig, "Configuration tarifaire récupérée avec succès.", 200);
  } catch (error) {
    return next(error);
  }
};

/**
 * Initialise un paiement automatisé auprès de la passerelle GeniusPay
 */
const initializePayment = async (req, res, next) => {
  try {
    const { planId = 'MONTHLY', platform = 'mobile' } = req.body;
    const userId = req.user._id;

    const result = await subscriptionService.initializeAutomatedPayment(userId, {
      planId,
      platform
    });

    logger.info(`[PAYMENT_INIT] Session générée pour user ${userId} (Ref: ${result.reference})`);

    return successResponse(
      res,
      result,
      "Session de paiement initialisée avec succès.",
      201
    );
  } catch (error) {
    return next(error);
  }
};

/**
 * Endpoint Webhook Public GeniusPay - Traitement asynchrone des événements de paiement
 */
const handleWebhook = async (req, res, next) => {
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const timestamp = req.headers['x-webhook-timestamp'] || req.headers['x-timestamp'];
  const event = req.headers['x-webhook-event'] || req.body?.event;

  // Récupération du raw body buffer ou string
  const rawBody = req.rawBody || JSON.stringify(req.body);

  // VÉRIFICATION DE LA SIGNATURE HMAC-SHA256
  const isValid = geniusPayService.verifyWebhookSignature(signature, timestamp, rawBody);
  
  if (!isValid && process.env.NODE_ENV === 'production') {
    logger.warn(`[WEBHOOK_SECURITY_ALERT] Signature webhook invalide rejetée depuis IP: ${req.ip}`);
    return res.status(401).json({ success: false, message: "Signature webhook non autorisée." });
  }

  // RÉPONSE IMMÉDIATE HTTP 200 (< 2s) requise par GeniusPay pour éviter les timeouts
  res.status(200).json({ received: true });

  // Traitement en arrière-plan (Background Worker)
  try {
    const io = req.app.get('socketio');
    const result = await subscriptionService.processPaymentWebhook(req.body, io);
    logger.info(`[WEBHOOK_PROCESSED] Résultat: ${JSON.stringify(result)} (Event: ${event})`);
  } catch (err) {
    logger.error(`[WEBHOOK_ASYNC_ERROR] Échec traitement webhook : ${err.message}`);
  }
};

/**
 * Vérification manuelle de secours / synchronisation de paiement
 */
const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const userId = req.user._id;
    const io = req.app.get('socketio');

    const result = await subscriptionService.verifyPaymentStatus(reference, userId, io);
    return successResponse(res, result, "Statut de la transaction synchronisé avec succès.", 200);
  } catch (error) {
    return next(error);
  }
};

/**
 * Récupère l'état d'abonnement en temps réel du chauffeur/vendeur
 */
const getStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('subscription phone');
    
    // Comptes Démo Google Play : Actifs à vie
    if (user?.phone && DEMO_PHONES.includes(user.phone)) {
      return successResponse(res, {
        isActive: true,
        isPending: false,
        expiresAt: new Date('2099-12-31T23:59:59Z')
      });
    }

    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 });

    return successResponse(res, {
      isActive,
      isPending: !!pendingTransaction,
      pendingReference: pendingTransaction?.paymentReference || null,
      expiresAt: user?.subscription?.expiresAt || null
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getConfig,
  initializePayment,
  handleWebhook,
  verifyPayment,
  getStatus
};