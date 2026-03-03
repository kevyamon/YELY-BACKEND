// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration des Preuves de Paiement
// STANDARD: Industriel / Bank Grade

const subscriptionService = require('../services/subscriptionService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const Transaction = require('../models/Transaction');

/**
 * Expose la configuration des paiements (Tarifs, Promo, Liens Wave) au Frontend.
 */
const getConfig = async (req, res) => {
  try {
    const config = subscriptionService.getSubscriptionPricing();
    
    if (!config.weekly.link || !config.monthly.link) {
      console.warn("[CONFIG WARNING]: Liens Wave manquants dans les variables d'environnement.");
    }

    return successResponse(res, config, "Configuration de souscription recuperee avec succes.", 200);
  } catch (error) {
    console.error("[CONFIG ERROR]:", error.message);
    return errorResponse(res, "Erreur interne lors de la recuperation de la configuration tarifaire.", 500);
  }
};

/**
 * Recoit la capture d'ecran et les infos du depot.
 */
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

/**
 * Recupere le statut actuel de l'abonnement pour l'interface utilisateur.
 */
const getStatus = async (req, res) => {
  try {
    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const pendingTransaction = await Transaction.findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    });

    return successResponse(res, {
      isActive,
      isPending: !!pendingTransaction,
      expiresAt: req.user.subscriptionExpiresAt || null
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