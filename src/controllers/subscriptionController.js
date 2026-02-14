// src/controllers/subscriptionController.js
// CONTROLLEUR ABONNEMENT - Gestion Cloudinary & Nettoyage Async
// CSCSM Level: Bank Grade

const Transaction = require('../models/Transaction');
const cloudinary = require('../config/cloudinary');
const fs = require('fs'); // On garde fs pour access
const fsPromises = require('fs').promises; // On ajoute promises pour unlink
const { successResponse, errorResponse } = require('../utils/responseHandler');

/**
 * @desc    Envoyer une preuve de paiement (Capture d'écran)
 * @route   POST /api/subscriptions/submit-proof
 */
const submitProof = async (req, res) => {
  const { amount, type, senderPhone } = req.body;

  if (!req.file) {
    return errorResponse(res, "Veuillez joindre une capture d'écran.", 400);
  }

  try {
    // 1. Upload Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'yely_proofs',
    });

    // 2. Isolation Financière
    const assignedTo = (type === 'WEEKLY') ? 'SUPERADMIN' : 'PARTNER';

    // 3. Création transaction
    const transaction = await Transaction.create({
      driver: req.user._id,
      amount,
      type,
      senderPhone,
      proofImageUrl: result.secure_url,
      proofPublicId: result.public_id,
      assignedTo,
      status: 'PENDING'
    });

    return successResponse(res, {
      transactionId: transaction._id
    }, "Preuve reçue ! Validation en cours.", 201);

  } catch (error) {
    console.error("Erreur Upload Preuve:", error);
    return errorResponse(res, "Échec de l'envoi de la preuve.");
  } finally {
    // 4. NETTOYAGE ASYNC (Ne bloque pas l'Event Loop) 🚀
    if (req.file) {
      fsPromises.unlink(req.file.path).catch(err => {
        console.error(`[CLEANUP ERROR] Impossible de supprimer ${req.file.path}:`, err.message);
      });
    }
  }
};

module.exports = { submitProof };