// src/controllers/adminController.js
// CONTROLEUR ADMIN - Degradation Gracieuse & Tolerance aux Pannes (Isolations Push)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const notificationService = require('../services/notificationService');
const Transaction = require('../models/Transaction');
// AJOUT SENIOR: Import du modèle AuditLog
const AuditLog = require('../models/AuditLog'); 
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

// ... (Garde toutes tes fonctions existantes intactes : updateAdminStatus, toggleUserBan, etc.) ...

const updateAdminStatus = async (req, res) => {
  try {
    const { userId, action } = req.body;
    const result = await adminService.updateUserRole(userId, action, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) io.to(userId.toString()).emit('user_role_updated', { newRole: result.newRole });
    } catch (e) { logger.warn(`[SOCKET] Echec non-critique: ${e.message}`); }

    logger.warn(`[AUDIT ROLE] ${req.user.email} changed ${result.email} -> ${result.newRole}`);
    return successResponse(res, result, 'Role mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const toggleUserBan = async (req, res) => {
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

const updateMapSettings = async (req, res) => {
  try {
    const settings = await adminService.updateMapSettings(req.body, req.user._id);
    logger.info(`[AUDIT MAP] Settings updated by ${req.user.email}`);
    return successResponse(res, settings, 'Parametres mis a jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const approveTransaction = async (req, res) => {
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
      
      notificationService.sendPushNotification(
        result.driver._id.toString(),
        "Abonnement Active",
        "Votre preuve de paiement a ete validee. Vous pouvez reprendre les courses.",
        { type: 'SUBSCRIPTION_APPROVED' }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification apres approbation: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications apres approbation: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} approved by ${req.user.email}`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvee avec succes.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await adminService.rejectTransaction(req.params.id, reason, req.user._id);

    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(result.driver._id.toString()).emit('subscription_rejected', { reason });
      }
      
      notificationService.sendPushNotification(
        result.driver._id.toString(),
        "Paiement Rejete",
        `Votre preuve a ete refusee: ${reason}. Veuillez soumettre une image valide.`,
        { type: 'SUBSCRIPTION_REJECTED' }
      ).catch(notifError => logger.error(`[NON-CRITIQUE] Echec notification apres rejet: ${notifError.message}`));
      
    } catch (notifError) {
      logger.error(`[NON-CRITIQUE] Echec general notifications apres rejet: ${notifError.message}`);
    }

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetee avec succes.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const getValidationQueue = async (req, res) => {
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
      pagination: {
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    };

    return successResponse(res, data, "File d'attente recuperee.");
  } catch (error) {
    logger.error(`[VALIDATION QUEUE ERROR]: ${error.message}`);
    return errorResponse(res, "Erreur lors de la recuperation des dossiers.", 500);
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return successResponse(res, stats, "Statistiques recuperees.");
  } catch (error) {
    logger.error(`[ADMIN STATS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les statistiques.", 500);
  }
};

const getAllUsers = async (req, res) => {
  try {
    const result = await adminService.getAllUsers(req.query, req.user.role);
    return successResponse(res, { users: result.users, pagination: result.pagination }, "Utilisateurs recuperes.");
  } catch (error) {
    logger.error(`[ADMIN USERS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les utilisateurs.", 500);
  }
};

const getFinanceData = async (req, res) => {
  try {
    const data = await adminService.getFinanceData(req.query.period);
    return successResponse(res, data, "Donnees financieres recuperees.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// Remplace uniquement cette fonction dans src/controllers/adminController.js
const togglePromo = async (req, res) => {
  try {
    const result = await adminService.togglePromo(req.body.isActive, req.user._id);

    // AJOUT SENIOR: Diffusion temps réel globale (io.emit touche tout le monde)
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.emit('promo_updated', { isPromoActive: result.isPromoActive });
      }
    } catch (socketError) {
      logger.error(`[SOCKET PROMO] Echec: ${socketError.message}`);
    }

    return successResponse(res, result, "Statut promo mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
// AJOUT SENIOR: Fonction pour récupérer l'historique d'audit
const getAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50); // Plus de logs par page
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find()
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 }) // Plus récents d'abord
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments()
    ]);

    return successResponse(res, {
      logs,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, "Journal récupéré.");
  } catch (error) {
    logger.error(`[AUDIT LOGS ERROR]: ${error.message}`);
    return errorResponse(res, "Impossible de récupérer le journal.", 500);
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
  getAllUsers,
  getFinanceData,
  togglePromo,
  updateWaveLinks,
  getAuditLogs // Ne pas oublier d'exporter !
};