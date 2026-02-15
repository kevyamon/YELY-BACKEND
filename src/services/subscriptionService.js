// src/services/subscriptionService.js
// SERVICE SOUSCRIPTION - Gestion Cloudinary & Transactions
// CSCSM Level: Bank Grade

const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');

/**
 * Traite la preuve de paiement avec mécanisme de rollback
 */
const processPaymentProof = async (driverId, driverEmail, data, filePath) => {
  let cloudinaryResult;

  try {
    // 1. Upload vers Cloudinary
    cloudinaryResult = await cloudinary.uploader.upload(filePath, {
      folder: 'yely_proofs',
      resource_type: 'image',
      transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    });

    // 2. Logique Métier : Isolation financière
    // Standardisation : WEEKLY -> SUPERADMIN, MONTHLY -> PARTNER
    const assignedTo = (data.type === 'WEEKLY') ? 'SUPERADMIN' : 'PARTNER';

    // 3. Persistance en Base de Données
    const transaction = await Transaction.create({
      driver: driverId,
      amount: data.amount,
      type: data.type,
      senderPhone: data.senderPhone,
      proofImageUrl: cloudinaryResult.secure_url,
      proofPublicId: cloudinaryResult.public_id,
      assignedTo,
      status: 'PENDING'
    });

    // 4. Audit Log immuable
    await AuditLog.create({
      actor: driverId,
      action: 'SUBMIT_PROOF',
      target: transaction._id,
      details: `Preuve de ${data.amount} FCFA (${data.type}) soumise par ${driverEmail}`
    });

    return transaction;

  } catch (error) {
    // 🛡️ ROLLBACK CLOUDINARY : Si la DB échoue après l'upload, on supprime l'image
    if (cloudinaryResult?.public_id) {
      await cloudinary.uploader.destroy(cloudinaryResult.public_id).catch(err => 
        console.error(`[CRITICAL] Rollback Cloudinary échoué: ${err.message}`)
      );
    }
    throw new AppError(error.message || "Erreur lors du traitement de la preuve.", 500);
  }
};

module.exports = { processPaymentProof };