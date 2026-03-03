// src/services/subscriptionService.js
// LOGIQUE ABONNEMENT - Round Robin & Gestion des Preuves
// STANDARD: Industriel / Bank Grade

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Settings = require('../models/Settings');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');

/**
 * Gere la distribution equitable des validations entre les admins (Round Robin).
 */
const getNextValidator = async () => {
  const admins = await User.find({ 
    role: { $in: ['admin', 'superadmin'] },
    isAvailable: true 
  }).sort({ _id: 1 });

  if (admins.length === 0) return null;

  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({ lastAssignedAdminIndex: 0 });
  }

  const nextIndex = (settings.lastAssignedAdminIndex + 1) % admins.length;
  settings.lastAssignedAdminIndex = nextIndex;
  await settings.save();

  return admins[nextIndex]._id;
};

/**
 * Soumission d'une preuve de paiement.
 */
const submitProof = async (userId, data, file) => {
  // 1. Verifier si une transaction est deja en attente
  const existingPending = await Transaction.findOne({ user: userId, status: 'PENDING' });
  if (existingPending) {
    throw new AppError("Une validation est deja en cours pour votre compte.", 400);
  }

  // 2. Determination du collecteur selon le forfait
  const collectorType = data.planId === 'WEEKLY' ? 'SUPERADMIN' : 'PARTNER';
  const amount = data.planId === 'WEEKLY' ? 1000 : 6000;

  // 3. Upload vers Cloudinary dans le dossier temporaire
  const result = await cloudinary.uploader.upload(file.path, {
    folder: 'yely/pending_proofs',
    resource_type: 'image'
  });

  // 4. Assignation via Round Robin
  const validatorId = await getNextValidator();

  // 5. Creation de la transaction
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
      note: `Preuve soumise pour le forfait ${data.planId}`
    }]
  });

  return transaction;
};

/**
 * Verifie si un chauffeur possede un abonnement actif.
 */
const checkSubscriptionStatus = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.subscriptionExpiresAt) return false;
  return user.subscriptionExpiresAt > new Date();
};

module.exports = {
  submitProof,
  checkSubscriptionStatus,
  getNextValidator
};