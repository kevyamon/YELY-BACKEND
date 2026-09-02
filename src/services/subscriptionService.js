// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Automatisation GeniusPay, Idempotence & Calculs Financiers
// STANDARD: Industriel / Bank Grade (Modularisé < 325 lignes)

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const geniusPayService = require('./geniusPayService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const PLAN_TYPES = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY'
};

const DEMO_PHONES = ['0100000001', '0100000002', '0100000003', '+2250100000001', '+2250100000002', '+2250100000003'];

/**
 * Vérifie si l'utilisateur est un Pionnier (les 20 premiers inscrits de son rôle)
 */
const checkIsPioneer = async (userIdOrUser) => {
  if (!userIdOrUser) return false;
  let user = userIdOrUser.role ? userIdOrUser : await User.findById(userIdOrUser);
  if (!user || (user.role !== 'driver' && user.role !== 'seller')) return false;

  const olderUsersCount = await User.countDocuments({
    role: user.role,
    createdAt: { $lt: user.createdAt }
  });

  return olderUsersCount < 20;
};

/**
 * Calcule la tarification certifiée pour un utilisateur
 */
const getSubscriptionPricing = async (userId = null) => {
  let settings = await Settings.findOne() || {};
  const isPromo = settings.isPromoActive || false;
  const isPioneer = await checkIsPioneer(userId);
  const baseMonthlyPrice = 2000; 

  let monthlyPrice;
  if (isPioneer) {
    monthlyPrice = isPromo ? 700 : 1000;
  } else {
    monthlyPrice = isPromo ? 1500 : baseMonthlyPrice;
  }
  
  return {
    isPromoActive: isPromo,
    isPioneer: isPioneer,
    monthly: {
      price: monthlyPrice,
      originalPrice: baseMonthlyPrice
    }
  };
};

/**
 * Initialise un paiement automatisé via GeniusPay
 */
const initializeAutomatedPayment = async (userId, { planId = PLAN_TYPES.MONTHLY, platform = 'mobile' }) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("Utilisateur introuvable.", 404);

  const pricingConfig = await getSubscriptionPricing(userId);
  const amount = pricingConfig.monthly.price;

  // Référence unique et sécurisée pour l'audit
  const reference = `YELY-SUB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Sélection dynamique de l'URL de retour selon la plateforme client
  const returnUrl = platform === 'pwa'
    ? (process.env.PWA_RETURN_URL || 'https://yely-amber.vercel.app')
    : (process.env.MOBILE_RETURN_URL || 'yely://subscription');

  const session = await geniusPayService.createPaymentSession({
    amount,
    reference,
    customer: {
      name: user.name || 'Utilisateur Yély',
      email: user.email || `${user.phone || 'client'}@yely.ci`,
      phone: user.phone || ''
    },
    description: `Abonnement Passe Yély Mensuel (${amount} FCFA)`,
    returnUrl,
    metadata: {
      userId: user._id.toString(),
      userRole: user.role,
      isPioneer: pricingConfig.isPioneer
    }
  });

  const transaction = await Transaction.create({
    user: userId,
    planId: PLAN_TYPES.MONTHLY,
    amount: amount,
    status: 'PENDING',
    paymentReference: reference,
    gateway: 'GENIUSPAY',
    gatewayTransactionId: session.gatewayTransactionId,
    customerPhone: user.phone || '',
    paymentUrl: session.paymentUrl,
    auditLog: [{
      action: 'INITIALIZED',
      note: `Session de paiement créée pour ${amount} FCFA (${pricingConfig.isPioneer ? 'Pionnier' : 'Standard'})`
    }]
  });

  return {
    paymentUrl: session.paymentUrl,
    reference: reference,
    amount: amount,
    transactionId: transaction._id
  };
};

/**
 * Traite la notification Webhook reçue de GeniusPay (Idempotence & Activation)
 */
const processPaymentWebhook = async (payload, io = null) => {
  const reference = payload.reference || payload.data?.reference || payload.order_id;
  const eventType = payload.event || payload.type || 'payment.success';
  const status = (payload.status || payload.data?.status || '').toLowerCase();
  const operator = payload.operator || payload.gateway || payload.data?.operator || 'GENIUSPAY';
  const gatewayTxId = payload.id || payload.transaction_id || payload.data?.id;

  if (!reference) {
    logger.warn('[WEBHOOK] Référence manquante dans le payload GeniusPay.');
    return { success: false, message: 'Référence manquante.' };
  }

  const transaction = await Transaction.findOne({ paymentReference: reference });
  if (!transaction) {
    logger.error(`[WEBHOOK_ERROR] Aucune transaction trouvée pour la référence ${reference}`);
    return { success: false, message: 'Transaction inconnue.' };
  }

  // PROTECTION IDEMPOTENCE : Si déjà traitée avec succès, on ignore sans re-créditer
  if (transaction.status === 'COMPLETED' || transaction.status === 'APPROVED') {
    logger.info(`[WEBHOOK_IDEMPOTENT] Transaction ${reference} déjà validée précédemment.`);
    return { success: true, alreadyProcessed: true, transaction };
  }

  const isSuccess = eventType === 'payment.success' || status === 'success' || status === 'completed' || status === 'paid';

  if (isSuccess) {
    transaction.status = 'COMPLETED';
    transaction.completedAt = new Date();
    transaction.operator = operator.toUpperCase();
    if (gatewayTxId) transaction.gatewayTransactionId = gatewayTxId;
    transaction.auditLog.push({
      action: 'PAYMENT_SUCCESS',
      note: `Paiement validé avec succès via ${operator}.`
    });
    await transaction.save();

    // Activation / Prolongation atomique de l'abonnement (+30 jours)
    const user = await User.findById(transaction.user);
    if (user) {
      const now = new Date();
      const currentExpiry = user.subscription?.expiresAt && new Date(user.subscription.expiresAt) > now
        ? new Date(user.subscription.expiresAt)
        : now;

      const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);

      user.subscription = {
        isActive: true,
        plan: PLAN_TYPES.MONTHLY,
        expiresAt: newExpiry,
        hoursRemaining: Math.ceil((newExpiry - now) / (1000 * 60 * 60))
      };
      await user.save({ validateBeforeSave: false });

      logger.info(`[SUBSCRIPTION_ACTIVATED] Compte ${user._id} activé jusqu'au ${newExpiry.toISOString()}`);

      // Notification en temps réel via Socket.io
      if (io) {
        io.to(user._id.toString()).emit('subscription_updated', {
          isActive: true,
          expiresAt: newExpiry,
          reference: reference
        });
      }
    }

    return { success: true, transaction };
  } else {
    transaction.status = 'FAILED';
    transaction.auditLog.push({
      action: 'PAYMENT_FAILED',
      note: `Paiement échoué ou annulé (${eventType} - ${status})`
    });
    await transaction.save();

    if (io) {
      io.to(transaction.user.toString()).emit('subscription_failed', {
        reference: reference,
        reason: 'Paiement non complété.'
      });
    }

    return { success: false, status: 'FAILED', transaction };
  }
};

/**
 * Vérifie et synchronise l'état d'un paiement en attente
 */
const verifyPaymentStatus = async (reference, userId, io = null) => {
  const transaction = await Transaction.findOne({ paymentReference: reference, user: userId });
  if (!transaction) throw new AppError("Transaction introuvable.", 404);

  if (transaction.status === 'COMPLETED' || transaction.status === 'APPROVED') {
    return { status: 'COMPLETED', isActive: true };
  }

  // Interrogation en direct de l'API GeniusPay
  const remoteData = await geniusPayService.checkPaymentStatus(reference);
  if (remoteData) {
    const remoteStatus = (remoteData.status || '').toLowerCase();
    if (remoteStatus === 'success' || remoteStatus === 'completed' || remoteStatus === 'paid') {
      await processPaymentWebhook({ reference, status: 'success', data: remoteData }, io);
      return { status: 'COMPLETED', isActive: true };
    }
  }

  return { status: transaction.status, isActive: false };
};

/**
 * Vérifie si l'abonnement d'un utilisateur est actif
 */
const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return false;

  if (user.phone && DEMO_PHONES.includes(user.phone)) return true;
  if (!user.subscription || !user.subscription.isActive) return false;

  if (user.subscription.expiresAt && new Date(user.subscription.expiresAt) < new Date()) {
    user.subscription.isActive = false;
    user.subscription.hoursRemaining = 0;
    await user.save({ validateBeforeSave: false });
    return false;
  }

  return true;
};

module.exports = {
  checkIsPioneer,
  getSubscriptionPricing,
  initializeAutomatedPayment,
  processPaymentWebhook,
  verifyPaymentStatus,
  checkSubscriptionStatus
};