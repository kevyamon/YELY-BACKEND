// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration des Preuves de Paiement
// STANDARD: Industriel / Bank Grade (Self-Healing Data)

const subscriptionService = require('../services/subscriptionService');
const { successResponse } = require('../utils/responseHandler');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const getConfig = async (req, res, next) => {
  try {
    const config = await subscriptionService.getSubscriptionPricing();
    
    if (!config.weekly.link || !config.monthly.link) {
      logger.warn("[CONFIG WARNING]: Liens de paiement manquants dans les variables d'environnement ou la base de données.");
    }

    return successResponse(res, config, "Configuration tarifaire récupérée avec succès.", 200);
  } catch (error) {
    return next(error);
  }
};

const submitProof = async (req, res, next) => {
  try {
    const { planId, senderPhone } = req.body;
    
    if (!planId || !senderPhone || !req.file) {
      throw new AppError("Veuillez fournir un plan, un numéro de téléphone et une capture d'écran valide.", 400);
    }

    const transaction = await subscriptionService.submitProof(
      req.user._id, 
      { planId, senderPhone }, 
      req.file
    );

    return successResponse(
      res, 
      { transactionId: transaction._id }, 
      "Preuve reçue. Un administrateur va vérifier votre paiement. Accès prévu sous 15 minutes.", 
      201
    );

  } catch (error) {
    return next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    });

    const user = await User.findById(req.user._id).select('subscription');
    let exactExpiresAt = user?.subscription?.expiresAt || null;

    if (!exactExpiresAt && user?.subscription?.isActive && user?.subscription?.hoursRemaining > 0) {
      const millisecondsRemaining = user.subscription.hoursRemaining * 60 * 60 * 1000;
      exactExpiresAt = new Date(Date.now() + millisecondsRemaining);
      
      await User.updateOne(
        { _id: req.user._id },
        { $set: { 'subscription.expiresAt': exactExpiresAt } }
      );
      
      logger.info(`[SUBSCRIPTION FIX] Date d'expiration générée et figée pour l'utilisateur ${req.user._id}`);
    }

    return successResponse(res, {
      isActive,
      isPending: !!pendingTransaction,
      expiresAt: exactExpiresAt
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getConfig,
  submitProof,
  getStatus
};