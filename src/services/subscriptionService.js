// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Assignation par lots (Lottery/Round Robin) & Gestion des Preuves
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
  if (!settings) {
    settings = await Settings.create({ lastAssignedAdminIndex: 0, validationCounter: 0 });
  }

  if (typeof settings.validationCounter === 'undefined') {
    settings.validationCounter = 0;
  }

  const currentAdminIndex = Math.floor(settings.validationCounter / ASSIGNMENT_LOT_SIZE) % admins.length;
  
  settings.validationCounter += 1;
  await settings.save();

  return admins[currentAdminIndex];
};

/**
 * MODIFICATION SENIOR : Lecture dynamique depuis la base de données (Settings)
 * au lieu du fichier .env statique.
 */
const getSubscriptionPricing = async () => {
  let settings = await Settings.findOne();
  if (!settings) settings = {}; // Fallback de sécurité

  const isPromo = settings.isPromoActive || false;
  
  return {
    isPromoActive: isPromo,
    weekly: {
      price: isPromo ? parseInt(process.env.PROMO_PRICE_WEEKLY || '500', 10) : 1000,
      // Priorité à la base de données pour les liens, sinon fallback sur le .env
      link: settings.waveLinkWeekly || process.env.WAVE_LINK_WEEKLY || '' 
    },
    monthly: {
      price: isPromo ? parseInt(process.env.PROMO_PRICE_MONTHLY || '4000', 10) : 6000,
      link: settings.waveLinkMonthly || process.env.WAVE_LINK_MONTHLY || ''
    }
  };
};

const submitProof = async (userId, data, file) => {
  const existingPending = await Transaction.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new AppError("Une validation est deja en cours pour votre compte.", 400);
  }

  // MODIFICATION SENIOR : getSubscriptionPricing est maintenant asynchrone (await)
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
      note: `Preuve soumise pour le forfait ${data.planId} (Montant theorique: ${amount}F CFA)`
    }]
  });

  if (validator && validator.fcmToken) {
    try {
      await notificationService.sendPushNotification(
        validator.fcmToken,
        "Nouvelle capture a verifier",
        "Un chauffeur vient de soumettre un paiement. Verification requise.",
        { transactionId: transaction._id.toString(), type: 'VALIDATION_REQUEST' }
      );
    } catch (error) {
      console.error("[NOTIFICATION ERROR]: Echec de l'envoi du Push au validateur", error.message);
    }
  }

  return transaction;
};

const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.subscriptionExpiresAt) return false;
  return user.subscriptionExpiresAt > new Date();
};

module.exports = {
  submitProof,
  checkSubscriptionStatus,
  getNextValidator,
  getSubscriptionPricing
};