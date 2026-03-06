// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Assignation par lots & Calculs Financiers Dynamiques
// STANDARD: Industriel / Bank Grade

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');
const notificationService = require('./notificationService');

const PLAN_TYPES = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY'
};

const COLLECTOR_TYPES = {
  SUPERADMIN: 'SUPERADMIN',
  PARTNER: 'PARTNER'
};

const getNextValidator = async (planType) => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});

  const superadmin = await User.findOne({ role: 'superadmin' });
  const partnerEmail = process.env.PARTNAIR || '';
  const partner = await User.findOne({ email: partnerEmail, role: 'admin' });

  const classicAdmins = await User.find({
    role: 'admin',
    email: { $ne: partnerEmail }
  }).sort({ _id: 1 });

  const fallbackValidator = superadmin || partner || classicAdmins[0];

  if (!settings.isLoadReduced) {
    if (planType === PLAN_TYPES.WEEKLY) return superadmin || fallbackValidator;
    if (planType === PLAN_TYPES.MONTHLY) return partner || fallbackValidator;
  }

  let targetValidator = null;

  if (planType === PLAN_TYPES.WEEKLY) {
    const cycle = Math.floor(settings.weeklyCounter / 3);
    if (cycle % 2 === 0 || classicAdmins.length === 0) {
      targetValidator = superadmin;
    } else {
      const index = settings.lastAssignedAdminIndex % classicAdmins.length;
      targetValidator = classicAdmins[index];
      settings.lastAssignedAdminIndex += 1;
    }
    settings.weeklyCounter += 1;
  }

  if (planType === PLAN_TYPES.MONTHLY) {
    const cycle = Math.floor(settings.monthlyCounter / 3);
    if (cycle % 2 === 0 || classicAdmins.length === 0) {
      targetValidator = partner;
    } else {
      const index = settings.lastAssignedAdminIndex % classicAdmins.length;
      targetValidator = classicAdmins[index];
      settings.lastAssignedAdminIndex += 1;
    }
    settings.monthlyCounter += 1;
  }

  await settings.save();
  return targetValidator || fallbackValidator;
};

const getSubscriptionPricing = async () => {
  let settings = await Settings.findOne();
  if (!settings) settings = {};

  const isPromo = settings.isPromoActive || false;
  
  const baseWeeklyPrice = 1000;
  const baseMonthlyPrice = 6000;

  const weeklyPrice = isPromo ? Math.round(baseWeeklyPrice * 0.6) : baseWeeklyPrice;
  const monthlyPrice = isPromo ? Math.round(baseMonthlyPrice * 0.6) : baseMonthlyPrice;
  
  return {
    isPromoActive: isPromo,
    weekly: {
      price: weeklyPrice,
      originalPrice: baseWeeklyPrice, 
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

  const validator = await getNextValidator(data.planId);
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

// 🛡️ MODIFICATION MAJEURE ICI : Synchronisation Forcée et Temps Réel
const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.subscription) return false;

  // Si l'abonnement est inactif, on ne va pas plus loin
  if (!user.subscription.isActive) return false;

  // Si on a des heures restantes mais pas de date d'expiration fixée, on la fixe.
  if (!user.subscription.expiresAt && user.subscription.hoursRemaining > 0) {
    const millisecondsRemaining = user.subscription.hoursRemaining * 60 * 60 * 1000;
    user.subscription.expiresAt = new Date(Date.now() + millisecondsRemaining);
    await user.save({ validateBeforeSave: false });
    return true;
  }

  // Vérification stricte de l'expiration
  if (user.subscription.expiresAt && new Date(user.subscription.expiresAt) < new Date()) {
    user.subscription.isActive = false;
    user.subscription.hoursRemaining = 0;
    await user.save({ validateBeforeSave: false });
    return false;
  }

  return true;
};

module.exports = { submitProof, checkSubscriptionStatus, getNextValidator, getSubscriptionPricing };