// src/controllers/subscriptionController.js
// CONTROLEUR ABONNEMENT - Orchestration des Preuves de Paiement
// STANDARD: Industriel / Bank Grade

const subscriptionService = require('../services/subscriptionService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * Recoit la capture d'ecran et les infos du depot.
 */
const submitProof = async (req, res) => {
  try {
    const { planId, senderPhone } = req.body;
    
    if (!planId || !senderPhone || !req.file) {
      return errorResponse(res, "Donnees ou capture manquante.", 400);
    }

    const transaction = await subscriptionService.submitProof(
      req.user._id, 
      { planId, senderPhone }, 
      req.file
    );

    // Message court et simple pour le chauffeur
    return successResponse(
      res, 
      { transactionId: transaction._id }, 
      "Recu ! Un administrateur verifie votre paiement. Acces sous 15 minutes.", 
      201
    );

  } catch (error) {
    console.error("[SUBMISSION ERROR]:", error.message);
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur lors de l'envoi de la preuve.", statusCode);
  }
};

/**
 * Recupere le statut actuel de l'abonnement pour l'UI.
 */
const getStatus = async (req, res) => {
  try {
    const isActive = await subscriptionService.checkSubscriptionStatus(req.user._id);
    const pendingTransaction = await require('../models/Transaction').findOne({ 
      user: req.user._id, 
      status: 'PENDING' 
    });

    return successResponse(res, {
      isActive,
      isPending: !!pendingTransaction,
      expiresAt: req.user.subscriptionExpiresAt
    });
  } catch (error) {
    return errorResponse(res, "Erreur lors de la recuperation du statut.", 500);
  }
};

module.exports = {
  submitProof,
  getStatus
};