// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration Passerelle GeniusPay & Webhooks Securises
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

    return successResponse(res, enrichedConfig, "Configuration tarifaire recuperee avec succes.", 200);
  } catch (error) {
    return next(error);
  }
};

const initializePayment = async (req, res, next) => {
  try {
    const { planId = 'MONTHLY', platform = 'mobile' } = req.body;
    const userId = req.user._id;

    const result = await subscriptionService.initializeAutomatedPayment(userId, {
      planId,
      platform
    });

    logger.info(`[PAYMENT_INIT] Session generee pour user ${userId} (Ref: ${result.reference})`);

    return successResponse(
      res,
      result,
      "Session de paiement initialisee avec succes.",
      201
    );
  } catch (error) {
    return next(error);
  }
};

const handleWebhook = async (req, res, next) => {
  const signature = req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const timestamp = req.headers['x-webhook-timestamp'] || req.headers['x-timestamp'];
  const event = req.headers['x-webhook-event'] || req.body?.event;

  const rawBody = req.rawBody || JSON.stringify(req.body);

  const isValid = geniusPayService.verifyWebhookSignature(signature, timestamp, rawBody);
  
  if (!isValid && process.env.NODE_ENV === 'production') {
    logger.warn(`[WEBHOOK_SECURITY_ALERT] Signature webhook invalide rejetee depuis IP: ${req.ip}`);
    return res.status(401).json({ success: false, message: "Signature webhook non autorisee." });
  }

  res.status(200).json({ received: true });

  try {
    const io = req.app.get('socketio');
    const result = await subscriptionService.processPaymentWebhook(req.body, io);
    logger.info(`[WEBHOOK_PROCESSED] Resultat: ${JSON.stringify(result)} (Event: ${event})`);
  } catch (err) {
    logger.error(`[WEBHOOK_ASYNC_ERROR] Echec traitement webhook : ${err.message}`);
  }
};

const verifyPayment = async (req, res, next) => {
  try {
    const { reference } = req.params;
    const userId = req.user._id;
    const io = req.app.get('socketio');

    const result = await subscriptionService.verifyPaymentStatus(reference, userId, io);
    return successResponse(res, result, "Statut de la transaction synchronise avec succes.", 200);
  } catch (error) {
    return next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw new AppError("Utilisateur introuvable.", 404);

    if (user.phone && DEMO_PHONES.includes(user.phone)) {
      return successResponse(res, {
        isActive: true,
        isPending: false,
        expiresAt: new Date('2099-12-31T23:59:59Z'),
        hoursRemaining: 999999
      });
    }

    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 });

    // Auto-reconciliation proactive : si une transaction est PENDING, interroger directement GeniusPay
    if (pendingTransaction && pendingTransaction.paymentReference) {
      try {
        const io = req.app.get('socketio');
        await subscriptionService.verifyPaymentStatus(pendingTransaction.paymentReference, req.user._id, io);
      } catch (checkErr) {
        logger.warn(`[AUTO_RECONCILE] Verification proactive en attente: ${checkErr.message}`);
      }
    }

    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const updatedUser = await User.findById(req.user._id).select('subscription');

    const remainingPending = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    }).sort({ createdAt: -1 });

    return successResponse(res, {
      isActive,
      isPending: !isActive && !!remainingPending,
      pendingReference: !isActive && remainingPending ? remainingPending.paymentReference : null,
      expiresAt: updatedUser?.subscription?.expiresAt || null,
      hoursRemaining: updatedUser?.subscription?.hoursRemaining || 0
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