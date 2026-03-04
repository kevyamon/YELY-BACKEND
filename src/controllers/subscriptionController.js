// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration des Preuves de Paiement
// STANDARD: Industriel / Bank Grade (Self-Healing Data)

const subscriptionService = require('../services/subscriptionService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const getConfig = async (req, res) => {
  try {
    const config = await subscriptionService.getSubscriptionPricing();
    
    if (!config.weekly.link || !config.monthly.link) {
      console.warn("[CONFIG WARNING]: Liens Wave manquants dans les variables d'environnement ou la DB.");
    }

    return successResponse(res, config, "Configuration de souscription recuperee avec succes.", 200);
  } catch (error) {
    console.error("[CONFIG ERROR]:", error.message);
    return errorResponse(res, "Erreur interne lors de la recuperation de la configuration tarifaire.", 500);
  }
};

const submitProof = async (req, res) => {
  try {
    const { planId, senderPhone } = req.body;
    
    if (!planId || !senderPhone || !req.file) {
      return errorResponse(res, "Donnees ou capture manquante. Requete rejetee.", 400);
    }

    const transaction = await subscriptionService.submitProof(
      req.user._id, 
      { planId, senderPhone }, 
      req.file
    );

    return successResponse(
      res, 
      { transactionId: transaction._id }, 
      "Preuve recue. Un administrateur verifie votre paiement. Acces prevu sous 15 minutes.", 
      201
    );

  } catch (error) {
    console.error("[SUBMISSION ERROR]:", error.message);
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur systeme lors de l'enregistrement de la preuve.", statusCode);
  }
};

const getStatus = async (req, res) => {
  try {
    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    });

    const user = await User.findById(req.user._id).select('subscription');
    let exactExpiresAt = user?.subscription?.expiresAt || null;

    // CORRECTION SENIOR : Auto-réparation (Self-Healing) pour les anciens comptes
    // Si l'utilisateur est actif, a des heures, mais pas de date d'expiration en base : on répare la base.
    if (!exactExpiresAt && user?.subscription?.isActive && user?.subscription?.hoursRemaining > 0) {
      const millisecondsRemaining = user.subscription.hoursRemaining * 60 * 60 * 1000;
      exactExpiresAt = new Date(Date.now() + millisecondsRemaining);
      
      // On fige définitivement cette date dans la base de données
      await User.updateOne(
        { _id: req.user._id },
        { $set: { 'subscription.expiresAt': exactExpiresAt } }
      );
      
      console.info(`[SUBSCRIPTION FIX] Date d'expiration générée et figée pour l'utilisateur ${req.user._id}`);
    }

    return successResponse(res, {
      isActive,
      isPending: !!pendingTransaction,
      expiresAt: exactExpiresAt
    });
  } catch (error) {
    console.error("[STATUS ERROR]:", error.message);
    return errorResponse(res, "Erreur lors de la lecture du statut d'abonnement.", 500);
  }
};

module.exports = {
  getConfig,
  submitProof,
  getStatus
};