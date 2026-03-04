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

// Cerveau de l'assignation (Round-Robin intelligent par 3)
const getNextValidator = async (planType) => {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});

  const superadmin = await User.findOne({ role: 'superadmin' });
  const partnerEmail = process.env.PARTNAIR || '';
  const partner = await User.findOne({ email: partnerEmail, role: 'admin' });

  // Les admins "classiques" (qui ne sont ni le partenaire ni le superadmin)
  const classicAdmins = await User.find({
    role: 'admin',
    email: { $ne: partnerEmail }
  }).sort({ _id: 1 });

  // Fallback de sécurité extrême au cas où
  const fallbackValidator = superadmin || partner || classicAdmins[0];

  if (!settings.isLoadReduced) {
    // MODE NORMAL : Assignation stricte
    if (planType === PLAN_TYPES.WEEKLY) return superadmin || fallbackValidator;
    if (planType === PLAN_TYPES.MONTHLY) return partner || fallbackValidator;
  }

  // MODE REDUCTION DE CHARGE (3 par 3)
  let targetValidator = null;

  if (planType === PLAN_TYPES.WEEKLY) {
    const cycle = Math.floor(settings.weeklyCounter / 3);
    
    // Si cycle pair (0, 2, 4...) ou aucun admin classique dispo -> Superadmin
    if (cycle % 2 === 0 || classicAdmins.length === 0) {
      targetValidator = superadmin;
    } else {
      // Cycle impair (1, 3, 5...) -> Admins classiques (tour de rôle)
      const index = settings.lastAssignedAdminIndex % classicAdmins.length;
      targetValidator = classicAdmins[index];
      settings.lastAssignedAdminIndex += 1;
    }
    settings.weeklyCounter += 1;
  }

  if (planType === PLAN_TYPES.MONTHLY) {
    const cycle = Math.floor(settings.monthlyCounter / 3);
    
    // Si cycle pair ou aucun admin classique dispo -> Partenaire
    if (cycle % 2 === 0 || classicAdmins.length === 0) {
      targetValidator = partner;
    } else {
      // Cycle impair -> Admins classiques (tour de rôle)
      const index = settings.lastAssignedAdminIndex % classicAdmins.length;
      targetValidator = classicAdmins[index];
      settings.lastAssignedAdminIndex += 1;
    }
    settings.monthlyCounter += 1;
  }

  await settings.save();
  return targetValidator || fallbackValidator;
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

  // On envoie le planId pour orienter le routeur intelligent
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

const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.subscription) return false;
  return user.subscription.isActive === true;
};

module.exports = { submitProof, checkSubscriptionStatus, getNextValidator, getSubscriptionPricing };