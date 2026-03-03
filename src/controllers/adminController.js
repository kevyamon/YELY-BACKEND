// src/controllers/adminController.js
// CONTROLEUR ADMIN - Logique de Gouvernance et Isolation Financiere
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const subscriptionService = require('../services/subscriptionService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');
const Transaction = require('../models/Transaction');
const cloudinary = require('../config/cloudinary');

/**
 * @desc Promouvoir/Retrograder (SuperAdmin)
 */
const updateAdminStatus = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { userId, action } = req.body;
    
    const result = await session.withTransaction(async () => {
      return await adminService.updateUserRole(userId, action, req.user._id, session);
    });

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.user.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Role mis a jour.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  } finally {
    session.endSession();
  }
};

/**
 * @desc Toggle Ban
 */
const toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    logger.warn(`[AUDIT BAN] ${req.user.email} toggled ban on ${user.email}.`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur banni.' : 'Bannissement leve.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Map Settings
 */
const updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Parametres mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Approve Transaction avec Isolation et Override
 */
const approveTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return errorResponse(res, 'Transaction introuvable.', 404);
    }

    // CONTROLE D'ISOLATION FINANCIERE (Bloque l'Admin sur l'Hebdo)
    if (req.user.role === 'admin' && transaction.type === 'WEEKLY') {
      logger.warn(`[SECURITY ALERT] Admin ${req.user.email} a tente de valider une transaction HEBDO.`);
      return errorResponse(res, 'Acces refuse. Perimetre limite aux abonnements mensuels.', 403);
    }

    let isOverride = false;
    if (req.user.role === 'superadmin' && transaction.type === 'MONTHLY') {
      isOverride = true;
    }

    const result = await session.withTransaction(async () => {
      // Execution du service
      const serviceResult = await adminService.approveTransaction(req.params.id, req.user._id, session);
      
      // Enregistrement de l'override si applicable
      if (isOverride) {
        await Transaction.findByIdAndUpdate(transaction._id, { intendedFor: 'ADMIN' }, { session });
      }
      
      return serviceResult;
    });

    // NETTOYAGE CLOUDINARY IMMEDIAT
    const publicIdToDestroy = result.proofPublicId || transaction.proofPublicId;
    if (publicIdToDestroy) {
      try {
        await cloudinary.uploader.destroy(publicIdToDestroy);
        logger.info(`[CLOUDINARY CLEANUP] Image ${publicIdToDestroy} supprimee.`);
      } catch (cloudErr) {
        logger.error(`[CLOUDINARY ERROR] Echec de suppression pour ${publicIdToDestroy}: ${cloudErr.message}`);
      }
    }

    // GHOST MODE : Notification Socket
    const io = req.app.get('socketio');
    io.to(result.driver._id.toString()).emit('subscription_validated', {
      hoursAdded: result.hoursToAdd,
      totalHours: result.driver.subscription.hoursRemaining,
      sender: "L'équipe Yély"
    });

    logger.info(`[AUDIT FINANCE] Transaction ${transaction._id} approved by ${req.user.email} (Override: ${isOverride})`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvee.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  } finally {
    session.endSession();
  }
};

/**
 * @desc Reject Transaction avec Isolation
 */
const rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    const transaction = await Transaction.findById(req.params.id);
    
    if (!transaction) {
      return errorResponse(res, 'Transaction introuvable.', 404);
    }

    // CONTROLE D'ISOLATION FINANCIERE
    if (req.user.role === 'admin' && transaction.type === 'WEEKLY') {
      return errorResponse(res, 'Acces refuse. Perimetre limite aux abonnements mensuels.', 403);
    }

    const result = await adminService.rejectTransaction(req.params.id, reason, req.user._id);

    // NETTOYAGE CLOUDINARY IMMEDIAT
    const publicIdToDestroy = result.transaction?.proofPublicId || transaction.proofPublicId;
    if (publicIdToDestroy) {
      try {
        await cloudinary.uploader.destroy(publicIdToDestroy);
        logger.info(`[CLOUDINARY CLEANUP] Image ${publicIdToDestroy} supprimee suite au rejet.`);
      } catch (cloudErr) {
        logger.error(`[CLOUDINARY ERROR] Echec de suppression pour ${publicIdToDestroy}: ${cloudErr.message}`);
      }
    }

    // GHOST MODE : Notification Socket
    const io = req.app.get('socketio');
    io.to(result.transaction.driver.toString()).emit('subscription_rejected', { 
      reason,
      sender: "L'équipe Yély"
    });

    logger.info(`[AUDIT FINANCE] Transaction ${transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetee.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Get Validation Queue
 */
const getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    
    const data = await subscriptionService.getPendingTransactions(req.user.role, page);

    return successResponse(res, data, "File d'attente recuperee.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * @desc Dashboard Stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return successResponse(res, stats, "Statistiques recuperees.");
  } catch (error) {
    logger.error(`[ADMIN STATS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les statistiques.", 500);
  }
};

/**
 * @desc Get All Users
 */
const getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs recuperes.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les utilisateurs.", 500);
  }
};

module.exports = {
  updateAdminStatus,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getValidationQueue,
  getDashboardStats,
  getAllUsers
};