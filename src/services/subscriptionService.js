// src/services/subscriptionService.js
// SERVICE SOUSCRIPTION - Gestion Cloudinary, Logique Métier & Base de Données
// CSCSM Level: Bank Grade

const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');
const logger = require('../config/logger'); // 🛡️ Import du logger sécurisé

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
    // 🛡️ ROLLBACK CLOUDINARY : On utilise Winston pour tracer proprement l'erreur
    if (cloudinaryResult?.public_id) {
      await cloudinary.uploader.destroy(cloudinaryResult.public_id).catch(err => 
        logger.error(`[CRITICAL] Rollback Cloudinary échoué: ${err.message}`)
      );
    }
    throw new AppError(error.message || "Erreur lors du traitement de la preuve.", 500);
  }
};

/**
 * 🛡️ ISOLATION : Méthode propre pour supprimer une preuve Cloudinary
 */
const deleteProof = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info(`[CLOUDINARY] Preuve supprimée avec succès: ${publicId}`);
  } catch (error) {
    logger.error(`[CLOUDINARY ERROR] Impossible de supprimer la preuve ${publicId}: ${error.message}`);
  }
};

/**
 * 🛡️ ISOLATION DB : Récupération de la file d'attente
 */
const getPendingTransactions = async (adminRole, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const query = { status: 'PENDING' };
  
  if (adminRole === 'admin') query.assignedTo = 'PARTNER';

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate('driver', 'name phone vehicle subscription')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(query)
  ]);

  return {
    transactions,
    pagination: { page, total, pages: Math.ceil(total / limit) }
  };
};

module.exports = { 
  processPaymentProof, 
  deleteProof, 
  getPendingTransactions 
};