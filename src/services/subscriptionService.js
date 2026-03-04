// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Assignation par lots & Calculs Financiers Dynamiques
// STANDARD: Industriel / Bank Grade

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');
const notificationService = require('./notificationService');

const ASSIGNMENT_LOT_SIZE = 3;

const PLAN_TYPES = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY'
};

const COLLECTOR_TYPES = {
  SUPERADMIN: 'SUPERADMIN',
  PARTNER: 'PARTNER'
};

const getNextValidator = async () => {
  const admins = await User.find({ 
    role: { $in: ['admin', 'superadmin'] },
    isAvailable: true 
  }).sort({ _id: 1 });

  if (admins.length === 0) return null;

  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({ lastAssignedAdminIndex: 0, validationCounter: 0 });

  if (typeof settings.validationCounter === 'undefined') settings.validationCounter = 0;

  const currentAdminIndex = Math.floor(settings.validationCounter / ASSIGNMENT_LOT_SIZE) % admins.length;
  settings.validationCounter += 1;
  await settings.save();

  return admins[currentAdminIndex];
};

/**
 * LECTURE DYNAMIQUE ET CALCUL DES -40% EN TEMPS REEL
 */
const getSubscriptionPricing = async () => {
  let settings = await Settings.findOne();
  if (!settings) settings = {};

  const isPromo = settings.isPromoActive || false;
  
  // Prix de base fixes (peuvent venir d'un .env si tu preferes)
  const baseWeeklyPrice = 1000;
  const baseMonthlyPrice = 6000;

  // Formule mathématique stricte: -40% (multiplier par 0.6)
  const weeklyPrice = isPromo ? Math.round(baseWeeklyPrice * 0.6) : baseWeeklyPrice;
  const monthlyPrice = isPromo ? Math.round(baseMonthlyPrice * 0.6) : baseMonthlyPrice;
  
  return {
    isPromoActive: isPromo,
    weekly: {
      price: weeklyPrice,
      originalPrice: baseWeeklyPrice, // Renvoi du prix d'origine pour le barrer sur le front
      link: settings.waveLinkWeekly || process.env.WAVE_LINK_WEEKLY || '' 
    },
    monthly: {
      price: monthlyPrice,
      originalPrice: baseMonthlyPrice,
      link: settings.waveLinkMonthly || process.env.WAVE_LINK_MONTHLY || ''
    }
  };
};

const submitProof = async (userId, data, file) => {
  const existingPending = await Transaction.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new AppError("Une validation est deja en cours pour votre compte.", 400);
  }

  // Le montant sera automatiquement le prix remisé à -40% si la promo est active
  const pricingConfig = await getSubscriptionPricing();
  let amount = 0;
  let collectorType = '';

  if (data.planId === PLAN_TYPES.WEEKLY) {
    amount = pricingConfig.weekly.price;
    collectorType = COLLECTOR_TYPES.SUPERADMIN;
  } else if (data.planId === PLAN_TYPES.MONTHLY) {
    amount = pricingConfig.monthly.price;
    collectorType = COLLECTOR_TYPES.PARTNER;
  } else {
    throw new AppError("Type de forfait invalide.", 400);
  }

  const result = await cloudinary.uploader.upload(file.path, {
    folder: 'yely/pending_proofs',
    resource_type: 'image'
  });

  const validator = await getNextValidator();
  const validatorId = validator ? validator._id : null;

  const transaction = await Transaction.create({
    user: userId,
    planId: data.planId,
    amount: amount,
    senderPhone: data.senderPhone,
    proofUrl: result.secure_url,
    proofPublicId: result.public_id,
    collectorType: collectorType,
    assignedTo: validatorId,
    auditLog: [{
      action: 'SUBMISSION',
      note: `Preuve soumise pour le forfait ${data.planId} (Montant: ${amount}F CFA)`
    }]
  });

  if (validator && validator.fcmToken) {
    try {
      await notificationService.sendPushNotification(
        validator.fcmToken,
        "Nouvelle capture a verifier",
        "Un chauffeur vient de soumettre un paiement.",
        { transactionId: transaction._id.toString(), type: 'VALIDATION_REQUEST' }
      );
    } catch (error) {}
  }

  return transaction;
};

const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.subscription) return false;
  return user.subscription.isActive === true;
};

module.exports = { submitProof, checkSubscriptionStatus, getNextValidator, getSubscriptionPricing };