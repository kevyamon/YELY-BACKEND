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
  
  const settings = await Settings.findOne();
  if (!settings || !settings.isPioneerProgramActive || !settings.pioneerProgramStartedAt) {
    return false;
  }

  let user = userIdOrUser.role ? userIdOrUser : await User.findById(userIdOrUser);
  if (!user || (user.role !== 'driver' && user.role !== 'seller')) return false;

  // Les comptes crees avant l'activation du bouton pionnier par l'admin sont exclus
  if (new Date(user.createdAt) < new Date(settings.pioneerProgramStartedAt)) {
    return false;
  }

  // Limitation stricte aux 4 premiers mois d'abonnement au tarif pionnier
  const monthsUsed = user.subscription?.pioneerMonthsUsed || 0;
  if (monthsUsed >= (settings.pioneerMaxMonths || 4)) {
    return false;
  }

  const limit = settings.pioneerLimitCount || 20;
  const olderPioneersCount = await User.countDocuments({
    role: user.role,
    createdAt: { 
      $gte: settings.pioneerProgramStartedAt,
      $lt: user.createdAt 
    }
  });

  return olderPioneersCount < limit;
};

const getSubscriptionPricing = async (userId = null) => {
  let settings = await Settings.findOne() || {};
  const isPromo = settings.isPromoActive || false;
  const isPioneer = await checkIsPioneer(userId);
  const baseMonthlyPrice = 2000; 

  let user = userId ? await User.findById(userId).select('subscription') : null;
  const monthsUsed = user?.subscription?.pioneerMonthsUsed || 0;
  const maxMonths = settings.pioneerMaxMonths || 4;

  const monthlyPrice = isPioneer ? (isPromo ? 700 : 1000) : (isPromo ? 1500 : baseMonthlyPrice);
  
  return {
    isPromoActive: isPromo,
    isPioneer: isPioneer,
    pioneerMonthsUsed: monthsUsed,
    pioneerMonthsRemaining: Math.max(0, maxMonths - monthsUsed),
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
    gatewayTransactionId: session.gatewayTransactionId || null,
    customerPhone: user.phone || '',
    paymentUrl: session.paymentUrl,
    auditLog: [{
      action: 'INITIALIZED',
      note: `Session pour ${amount} FCFA (${pricingConfig.isPioneer ? `Pionnier ${pricingConfig.pioneerMonthsUsed + 1}/4` : 'Standard'}). Ref: ${session.gatewayTransactionId || 'N/A'}`
    }]
  });

  return {
    paymentUrl: session.paymentUrl,
    reference: reference,
    gatewayReference: session.gatewayTransactionId || null,
    amount: amount,
    transactionId: transaction._id
  };
};

const processPaymentWebhook = async (payload, io = null) => {
  const reference = payload.reference || payload.data?.reference || payload.order_id || payload.data?.order_id;
  const eventType = payload.event || payload.type || payload.data?.event || 'payment.success';
  const status = (payload.status || payload.data?.status || '').toLowerCase();
  const operator = payload.operator || payload.gateway || payload.data?.operator || 'GENIUSPAY';
  const gatewayTxId = payload.id || payload.transaction_id || payload.payment_id || payload.data?.id || payload.data?.transaction_id || payload.data?.payment_id;
  const metaUserId = payload.metadata?.userId || payload.data?.metadata?.userId;

  const searchCriteria = [];
  if (reference) searchCriteria.push({ paymentReference: reference }, { gatewayTransactionId: reference });
  if (gatewayTxId) searchCriteria.push({ gatewayTransactionId: gatewayTxId }, { paymentReference: gatewayTxId });

  let transaction = null;
  if (searchCriteria.length > 0) {
    transaction = await Transaction.findOne({ $or: searchCriteria }).sort({ createdAt: -1 });
  }

  // Securite de repli: Si l'identifiant webhook diverge, associer via metadata.userId
  if (!transaction && metaUserId) {
    transaction = await Transaction.findOne({ user: metaUserId, status: 'PENDING' }).sort({ createdAt: -1 });
  }

  if (!transaction) {
    logger.warn(`[WEBHOOK_WARN] Aucune transaction trouvée pour ref: ${reference || gatewayTxId}`);
    return { success: false, message: 'Transaction inconnue.' };
  }

  if (transaction.status === 'COMPLETED' || transaction.status === 'APPROVED') {
    logger.info(`[WEBHOOK_IDEMPOTENT] Transaction ${transaction.paymentReference} déjà validée.`);
    return { success: true, alreadyProcessed: true, transaction };
  }

  const isSuccess = ['payment.success', 'payment.completed'].includes(eventType) || ['success', 'completed', 'paid', 'approved'].includes(status);

  if (isSuccess) {
    transaction.status = 'COMPLETED';
    transaction.completedAt = new Date();
    transaction.operator = operator.toUpperCase();
    if (gatewayTxId && !transaction.gatewayTransactionId) transaction.gatewayTransactionId = gatewayTxId;
    transaction.auditLog.push({
      action: 'PAYMENT_SUCCESS',
      note: `Paiement validé avec succès via ${operator} (${gatewayTxId || reference || 'N/A'}).`
    });
    await transaction.save();

    const user = await User.findById(transaction.user);
    if (user) {
      const now = new Date();
      const currentExpiry = user.subscription?.expiresAt && new Date(user.subscription.expiresAt) > now
        ? new Date(user.subscription.expiresAt)
        : now;

      const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);
      const isPioneerTx = transaction.auditLog?.some(l => l.note?.includes('Pionnier')) || false;
      const prevMonths = user.subscription?.pioneerMonthsUsed || 0;
      const pioneerMonthsUsed = isPioneerTx ? prevMonths + 1 : prevMonths;

      user.subscription = {
        isActive: true,
        plan: PLAN_TYPES.MONTHLY,
        expiresAt: newExpiry,
        hoursRemaining: Math.ceil((newExpiry - now) / (1000 * 60 * 60)),
        pioneerMonthsUsed
      };
      await user.save({ validateBeforeSave: false });

      logger.info(`[SUBSCRIPTION_ACTIVATED] Compte ${user._id} activé (Pionnier mois ${pioneerMonthsUsed}/4) jusqu'au ${newExpiry.toISOString()}`);

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
  const searchCriteria = [];
  if (reference) {
    searchCriteria.push({ paymentReference: reference }, { gatewayTransactionId: reference });
  }

  let transaction = searchCriteria.length > 0
    ? await Transaction.findOne({ $or: searchCriteria, user: userId }).sort({ createdAt: -1 })
    : null;

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

  // Interrogation de GeniusPay: tester tous les identifiants disponibles
  const candidateRefs = [
    transaction.gatewayTransactionId,
    transaction.paymentReference,
    reference
  ].filter(Boolean);

  let remoteData = null;
  for (const ref of [...new Set(candidateRefs)]) {
    remoteData = await geniusPayService.checkPaymentStatus(ref);
    if (remoteData) break;
  }

  if (remoteData) {
    const remoteStatus = (remoteData.status || remoteData.data?.status || '').toLowerCase();
    if (['success', 'completed', 'paid', 'approved'].includes(remoteStatus)) {
      const gTxId = remoteData.reference || remoteData.payment_id || remoteData.id || remoteData.data?.reference || remoteData.data?.payment_id;
      if (gTxId && !transaction.gatewayTransactionId) {
        transaction.gatewayTransactionId = gTxId;
        await transaction.save();
      }

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
    const isValid = now < expiry;
    const hoursLeft = isValid ? Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60))) : 0;

    if (user.subscription.isActive !== isValid || user.subscription.hoursRemaining !== hoursLeft) {
      user.subscription.isActive = isValid;
      user.subscription.hoursRemaining = hoursLeft;
      await user.save({ validateBeforeSave: false });
    }
    return isValid;
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