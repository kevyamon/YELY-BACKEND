// src/controllers/subscriptionController.js
// CONTROLLEUR SOUSCRIPTION - Orchestration & Cleanup
// CSCSM Level: Bank Grade

const subscriptionService = require('../services/subscriptionService');
const fsPromises = require('fs').promises;
const { successResponse, errorResponse } = require('../utils/responseHandler');

const submitProof = async (req, res) => {
  if (!req.file) {
    return errorResponse(res, "Capture d'écran manquante.", 400);
  }

  try {
    // Le service gère l'intelligence métier et Cloudinary
    const transaction = await subscriptionService.processPaymentProof(
      req.user._id,
      req.user.email,
      req.body,
      req.file.path
    );

    return successResponse(res, { 
      transactionId: transaction._id 
    }, "Preuve reçue ! Un administrateur va valider votre paiement.", 201);

  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  } finally {
    // 🧹 NETTOYAGE SYSTÉMATIQUE DU FICHIER LOCAL
    // Important pour éviter la saturation du disque du serveur
    if (req.file?.path) {
      fsPromises.unlink(req.file.path).catch(err => 
        console.error(`[CLEANUP ERROR] ${req.file.path}:`, err.message)
      );
    }
  }
};

module.exports = { submitProof };