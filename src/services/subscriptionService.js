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

// 🛡️ NOUVELLE FONCTION : Vérifie si le chauffeur fait partie des 20 premiers
const checkIsPioneer = async (userId) => {
  if (!userId) return false;
  
  const user = await User.findById(userId);
  if (!user || user.role !== 'driver') return false;

  // On compte combien de chauffeurs ont été créés AVANT ce chauffeur
  const olderDriversCount = await User.countDocuments({
    role: 'driver',
    createdAt: { $lt: user.createdAt }
  });

  // S'il y a moins de 20 chauffeurs avant lui, il est Pionnier à vie !
  return olderDriversCount < 20;
};

// 🛡️ MODIFICATION : On accepte userId pour personnaliser le prix
const getSubscriptionPricing = async (userId = null) => {
  let settings = await Settings.findOne();
  if (!settings) settings = {};

  const isPromo = settings.isPromoActive || false;
  const isPioneer = await checkIsPioneer(userId);
  
  // Prix d'affichage barrés (Toujours les mêmes pour montrer l'économie)
  const baseWeeklyPrice = 1000;
  const baseMonthlyPrice = 3500; 

  let weeklyPrice, monthlyPrice, weeklyLink, monthlyLink;

  if (isPioneer) {
    // 👑 TARIFS PIONNIERS (Les 20 Premiers à vie)
    weeklyPrice = isPromo ? 500 : 700;
    monthlyPrice = isPromo ? 1500 : 2500;
    
    weeklyLink = isPromo 
      ? process.env.WAVE_LINK_WEEKLY_PIONEER_PROMO 
      : process.env.WAVE_LINK_WEEKLY_PIONEER;
      
    monthlyLink = isPromo 
      ? process.env.WAVE_LINK_MONTHLY_PIONEER_PROMO 
      : process.env.WAVE_LINK_MONTHLY_PIONEER;
      
  } else {
    // 🚕 TARIFS NORMAUX
    weeklyPrice = isPromo ? 700 : baseWeeklyPrice;
    monthlyPrice = isPromo ? 2500 : baseMonthlyPrice;
    
    weeklyLink = isPromo 
      ? process.env.WAVE_LINK_WEEKLY_PROMO 
      : (settings.waveLinkWeekly || process.env.WAVE_LINK_WEEKLY || '');
      
    monthlyLink = isPromo 
      ? process.env.WAVE_LINK_MONTHLY_PROMO 
      : (settings.waveLinkMonthly || process.env.WAVE_LINK_MONTHLY || '');
  }
  
  return {
    isPromoActive: isPromo,
    isPioneer: isPioneer, // Le front saura si c'est un boss !
    weekly: {
      price: weeklyPrice,
      originalPrice: baseWeeklyPrice, 
      link: weeklyLink 
    },
    monthly: {
      price: monthlyPrice,
      originalPrice: baseMonthlyPrice,
      link: monthlyLink
    }
  };
};

const submitProof = async (userId, data, file) => {
  const existingPending = await Transaction.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new AppError("Une validation est deja en cours pour votre compte.", 400);
  }

  // On passe le userId pour avoir le bon tarif lors de la création de la transaction
  const pricingConfig = await getSubscriptionPricing(userId);
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
      note: `Preuve soumise pour le forfait ${data.planId} (Montant: ${amount}F CFA${pricingConfig.isPioneer ? ' - Tarif Pionnier' : ''})`
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

  if (!user.subscription.isActive) return false;

  if (!user.subscription.expiresAt && user.subscription.hoursRemaining > 0) {
    const millisecondsRemaining = user.subscription.hoursRemaining * 60 * 60 * 1000;
    user.subscription.expiresAt = new Date(Date.now() + millisecondsRemaining);
    await user.save({ validateBeforeSave: false });
    return true;
  }

  if (user.subscription.expiresAt && new Date(user.subscription.expiresAt) < new Date()) {
    user.subscription.isActive = false;
    user.subscription.hoursRemaining = 0;
    await user.save({ validateBeforeSave: false });
    return false;
  }

  return true;
};

module.exports = { submitProof, checkSubscriptionStatus, getNextValidator, getSubscriptionPricing };