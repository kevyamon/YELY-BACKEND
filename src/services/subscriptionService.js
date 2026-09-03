// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Automatisation GeniusPay, Idempotence & Calculs Financiers
// STANDARD: Industriel / Bank Grade (Modularise < 325 lignes, Sans Emojis)

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

const initializeAutomatedPayment = async (userId, { planId = PLAN_TYPES.MONTHLY, platform = 'mobile' }) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("Utilisateur introuvable.", 404);

  const pricingConfig = await getSubscriptionPricing(userId);
  const amount = pricingConfig.monthly.price;

  const reference = `YELY-SUB-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Utilisation d'une URL HTTPS valide et certifiee pour eviter le fallback GeniusPay
  const returnUrl = process.env.APP_RETURN_URL || process.env.PWA_RETURN_URL || 'https://yely-amber.vercel.app';

  const session = await geniusPayService.createPaymentSession({
    amount,
    reference,
    customer: {
      name: user.name || 'Utilisateur Yely',
      email: user.email || `${user.phone || 'client'}@yely.ci`,
      phone: user.phone || ''
    },
    description: `Abonnement Passe Yely Mensuel (${amount} FCFA)`,
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
      note: `Session de paiement creee pour ${amount} FCFA (${pricingConfig.isPioneer ? 'Pionnier' : 'Standard'})`
    }]
  });

  return {
    paymentUrl: session.paymentUrl,
    reference: reference,
    amount: amount,
    transactionId: transaction._id
  };
};

const processPaymentWebhook = async (payload, io = null) => {
  const reference = payload.reference || payload.data?.reference || payload.order_id || payload.data?.order_id;
  const eventType = payload.event || payload.type || payload.data?.event || 'payment.success';
  const status = (payload.status || payload.data?.status || '').toLowerCase();
  const operator = payload.operator || payload.gateway || payload.data?.operator || 'GENIUSPAY';
  const gatewayTxId = payload.id || payload.transaction_id || payload.data?.id || payload.data?.transaction_id;

  const searchCriteria = [];
  if (reference) searchCriteria.push({ paymentReference: reference }, { gatewayTransactionId: reference });
  if (gatewayTxId) searchCriteria.push({ gatewayTransactionId: gatewayTxId }, { paymentReference: gatewayTxId });
  if (payload.reference) searchCriteria.push({ paymentReference: payload.reference });
  if (payload.data?.reference) searchCriteria.push({ paymentReference: payload.data.reference }, { gatewayTransactionId: payload.data.reference });

  let transaction = null;
  if (searchCriteria.length > 0) {
    transaction = await Transaction.findOne({ $or: searchCriteria }).sort({ createdAt: -1 });
  }

  if (!transaction) {
    logger.warn(`[WEBHOOK_WARN] Aucune transaction trouvée pour ref: ${reference || gatewayTxId}`);
    return { success: false, message: 'Transaction inconnue.' };
  }

  if (transaction.status === 'COMPLETED' || transaction.status === 'APPROVED') {
    logger.info(`[WEBHOOK_IDEMPOTENT] Transaction ${transaction.paymentReference} déjà validée.`);
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

      if (io) {
        io.to(user._id.toString()).emit('subscription_updated', {
          isActive: true,
          expiresAt: newExpiry,
          reference: transaction.paymentReference
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
        reference: transaction.paymentReference,
        reason: 'Paiement non complété.'
      });
    }

    return { success: false, status: 'FAILED', transaction };
  }
};

const verifyPaymentStatus = async (reference, userId, io = null) => {
  let transaction = await Transaction.findOne({
    $or: [
      { paymentReference: reference },
      { gatewayTransactionId: reference }
    ],
    user: userId
  }).sort({ createdAt: -1 });

  if (!transaction) {
    transaction = await Transaction.findOne({ user: userId, status: 'PENDING' }).sort({ createdAt: -1 });
  }

  if (!transaction) throw new AppError("Transaction introuvable.", 404);

  if (transaction.status === 'COMPLETED' || transaction.status === 'APPROVED') {
    const user = await User.findById(userId).select('subscription');
    return { 
      status: 'COMPLETED', 
      isActive: true, 
      expiresAt: user?.subscription?.expiresAt || null 
    };
  }

  // Interrogation par référence Yély puis par ID transaction passerelle
  let remoteData = await geniusPayService.checkPaymentStatus(transaction.paymentReference);
  if (!remoteData && transaction.gatewayTransactionId) {
    remoteData = await geniusPayService.checkPaymentStatus(transaction.gatewayTransactionId);
  }

  if (remoteData) {
    const remoteStatus = (remoteData.status || remoteData.data?.status || '').toLowerCase();
    if (['success', 'completed', 'paid', 'approved'].includes(remoteStatus)) {
      await processPaymentWebhook({ 
        reference: transaction.paymentReference, 
        status: 'success', 
        data: remoteData 
      }, io);
      
      const user = await User.findById(userId).select('subscription');
      return { 
        status: 'COMPLETED', 
        isActive: true, 
        expiresAt: user?.subscription?.expiresAt || null 
      };
    }
  }

  return { status: transaction.status, isActive: false };
};

const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return false;

  if (user.phone && DEMO_PHONES.includes(user.phone)) return true;
  if (!user.subscription) return false;

  if (user.subscription.expiresAt) {
    const now = new Date();
    const expiry = new Date(user.subscription.expiresAt);
    if (now < expiry) {
      const hoursLeft = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60)));
      if (!user.subscription.isActive || user.subscription.hoursRemaining !== hoursLeft) {
        user.subscription.isActive = true;
        user.subscription.hoursRemaining = hoursLeft;
        await user.save({ validateBeforeSave: false });
      }
      return true;
    } else {
      if (user.subscription.isActive || user.subscription.hoursRemaining > 0) {
        user.subscription.isActive = false;
        user.subscription.hoursRemaining = 0;
        await user.save({ validateBeforeSave: false });
      }
      return false;
    }
  }

  return Boolean(user.subscription.isActive);
};

module.exports = {
  checkIsPioneer,
  getSubscriptionPricing,
  initializeAutomatedPayment,
  processPaymentWebhook,
  verifyPaymentStatus,
  checkSubscriptionStatus
};