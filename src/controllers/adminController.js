// src/controllers/adminController.js
// CONTROLEUR ADMIN - Exposition des Endpoints HTTP d'Administration
// STANDARD: Industriel / Bank Grade (Délégation active)

const adminService = require('../services/adminService');
const Transaction = require('../models/Transaction');
const AuditLog = require('../models/AuditLog'); 
const AppError = require('../utils/AppError');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');
const notificationService = require('../services/notificationService');

const adminConfigController = require('./adminConfigController');
const adminMarketplaceController = require('./adminMarketplaceController');

exports.updateAdminStatus = async (req, res) => {
  try {
    const { userId, action } = req.body;
    const result = await adminService.updateUserRole(userId, action, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(userId.toString()).emit('user_role_updated', { newRole: result.newRole });
        if (result.action === 'REVOKE') {
          io.to(userId.toString()).emit('force_logout', { reason: 'Vos droits administrateur ont ete revoques.' });
        }
      }
    } catch (e) { logger.warn(`[SOCKET] Echec non-critique: ${e.message}`); }

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Role mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    try {
      const io = req.app.get('socketio');
      if (io) io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
    } catch (e) { logger.warn(`[SOCKET] Echec non-critique: ${e.message}`); }

    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}.`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur banni.' : 'Bannissement leve.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Parametres mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.approveTransaction = async (req, res) => {
  try {
    const result = await adminService.approveTransaction(req.params.id, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_validated', {
          daysAdded: result.daysToAdd,
          expiresAt: result.newExpiryDate
        });
      }
      
      const isSeller = result.driver.role === 'seller';
      const pushTitle = isSeller ? "Boutique Activée" : "Abonnement Activé";
      const pushBody = isSeller 
        ? "Votre preuve de paiement a été validée. Votre boutique est active."
        : "Votre preuve de paiement a été validée. Vous pouvez reprendre les courses.";
      const pushType = isSeller ? 'SELLER_SUBSCRIPTION_APPROVED' : 'SUBSCRIPTION_APPROVED';

      notificationService.sendNotification(
        result.driver._id.toString(),
        pushTitle,
        pushBody,
        pushType,
        { transactionId: result.transaction._id.toString() }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} approved by ${req.user.email}`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvée avec succès.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    const finalReason = reason || "Preuve non conforme ou illisible.";
    const result = await adminService.rejectTransaction(req.params.id, finalReason, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_rejected', { reason: finalReason });
      }
      
      const isSeller = result.driver?.role === 'seller';
      const pushTitle = "Paiement Rejeté";
      const pushBody = `Votre preuve a été refusée: ${finalReason}. Veuillez soumettre une image valide.`;
      const pushType = isSeller ? 'SELLER_SUBSCRIPTION_REJECTED' : 'SUBSCRIPTION_REJECTED';

      notificationService.sendNotification(
        result.driver._id.toString(),
        pushTitle,
        pushBody,
        pushType,
        { transactionId: result.transaction._id.toString() }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetée avec succès.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

exports.getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter = { status: 'PENDING' };
    if (req.user.role !== 'superadmin') {
      filter.assignedTo = req.user._id;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('user', 'name phone email currentLocation')
        .populate('assignedTo', 'name email')
        .sort({ createdAt: 1 }) 
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    const data = {
      transactions,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    };

    return successResponse(res, data, "File d'attente recuperee.");
  } catch (error) {
    logger.error(`[VALIDATION QUEUE ERROR]: ${error.message}`);
    return errorResponse(res, "Erreur lors de la recuperation des dossiers.", 500);
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role, req.user._id);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs recuperes.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les utilisateurs.", 500);
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50); 
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find()
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 }) 
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments()
    ]);

    return successResponse(res, {
      logs,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Journal recupere.");
  } catch (error) {
    logger.error(`[AUDIT LOGS ERROR]: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer le journal.", 500);
  }
};

// --- DELEGATION CONFIGURATION ENDPOINTS ---
exports.getDashboardStats = adminConfigController.getDashboardStats;
exports.getFinanceData = adminConfigController.getFinanceData;
exports.togglePromo = adminConfigController.togglePromo;
exports.updateWaveLinks = adminConfigController.updateWaveLinks;
exports.toggleLoadReduce = adminConfigController.toggleLoadReduce;
exports.toggleGlobalFreeAccess = adminConfigController.toggleGlobalFreeAccess;
exports.updateAppVersion = adminConfigController.updateAppVersion;
exports.getSystemConfig = adminConfigController.getSystemConfig;

// --- DELEGATION MARKETPLACE ENDPOINTS ---
exports.getMarketplaceStats = adminMarketplaceController.getMarketplaceStats;
exports.getMarketplaceOrders = adminMarketplaceController.getMarketplaceOrders;
exports.overrideMarketplaceOrder = adminMarketplaceController.overrideMarketplaceOrder;
exports.getMarketplaceLedgers = adminMarketplaceController.getMarketplaceLedgers;
exports.forceClearLedger = adminMarketplaceController.forceClearLedger;
exports.getAllRides = adminMarketplaceController.getAllRides;
exports.toggleRideArchive = adminMarketplaceController.toggleRideArchive;

// Helper pour extraire le Public ID Cloudinary
const extractCloudinaryPublicId = (url) => {
  if (!url || !url.includes('cloudinary.com')) return null;
  const match = url.match(/\/upload\/v\d+\/(.+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
};

// Helper pour supprimer un fichier Cloudinary
const deleteCloudinaryFile = async (url) => {
  try {
    const publicId = extractCloudinaryPublicId(url);
    if (publicId) {
      const cloudinary = require('../config/cloudinary');
      await cloudinary.uploader.destroy(publicId);
      logger.info(`[Cloudinary] Image détruite : ${publicId}`);
    }
  } catch (err) {
    logger.error(`[Cloudinary ERROR] Echec de suppression : ${err.message}`);
  }
};

exports.getPendingDrivers = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const query = { role: 'driver', verificationStatus: 'pending' };

    const [drivers, total] = await Promise.all([
      User.find(query)
        .select('name phone email vehicle documents verificationStatus createdAt')
        .sort({ updatedAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ]);

    const data = {
      drivers,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    };

    return successResponse(res, data, "Chauffeurs en attente récupérés avec succès.");
  } catch (error) {
    logger.error(`[PENDING DRIVERS ERROR] ${error.message}`);
    return next(new AppError("Erreur lors de la récupération des validations d'identité.", 500));
  }
};

exports.verifyDriver = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const { id } = req.params;
    const { decision, reason } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError('Décision invalide. Doit être approved ou rejected.', 400);
    }

    const driver = await User.findById(id);
    if (!driver || driver.role !== 'driver') {
      throw new AppError('Chauffeur introuvable.', 404);
    }

    const previousFrontUrl = driver.documents?.idCardFront;
    const previousBackUrl = driver.documents?.idCardBack;

    driver.verificationStatus = decision;
    driver.isAvailable = false; // Par sécurité, forcer hors ligne

    if (decision === 'rejected') {
      driver.rejectionReason = reason || "Documents non conformes.";
    } else {
      driver.rejectionReason = "";
    }

    // RGPD & Libération de l'espace Cloudinary : Supprimer les images d'identité après décision
    if (previousFrontUrl) {
      await deleteCloudinaryFile(previousFrontUrl);
      driver.documents.idCardFront = "";
    }
    if (previousBackUrl) {
      await deleteCloudinaryFile(previousBackUrl);
      driver.documents.idCardBack = "";
    }
    driver.documents.idCard = ""; // Nettoyer l'ancienne clé brute si présente

    await driver.save();

    // Journal d'audit
    await AuditLog.create({
      actor: req.user._id,
      action: decision === 'approved' ? 'APPROVE_DRIVER_IDENTITY' : 'REJECT_DRIVER_IDENTITY',
      target: driver._id,
      details: decision === 'approved' ? 'Identité approuvée' : `Rejet: ${reason}`
    }).catch(() => {});

    // Notifications temps réel et push
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(driver._id.toString()).emit('identity_verification_update', {
          status: decision,
          reason: driver.rejectionReason
        });
        io.to(driver._id.toString()).emit('force_availability_offline');
      }

      const pushTitle = decision === 'approved' ? "Identité Validée ✅" : "Vérification Refusée ❌";
      const pushBody = decision === 'approved'
        ? "Votre identité et votre modèle de tricycle ont été validés par l'administration !"
        : `Votre dossier de vérification a été refusé : ${driver.rejectionReason}`;

      notificationService.sendNotification(
        driver._id.toString(),
        pushTitle,
        pushBody,
        decision === 'approved' ? 'IDENTITY_APPROVED' : 'IDENTITY_REJECTED',
        { status: decision }
      ).catch(() => {});

    } catch (e) {
      logger.error(`[NOTIF ERROR] verifyDriver: ${e.message}`);
    }

    return successResponse(res, { verificationStatus: driver.verificationStatus }, `Dossier chauffeur traité avec succès (${decision}).`);
  } catch (error) {
    return next(error);
  }
};