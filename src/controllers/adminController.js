// src/controllers/adminController.js
// CONTROLEUR ADMIN - Integration Temps Reel & Degradation Gracieuse (Sans Session MongoDB)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const adminService = require('../services/adminService');
const notificationService = require('../services/notificationService');
const Transaction = require('../models/Transaction');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

const updateAdminStatus = async (req, res) => {
  try {
    const { userId, action } = req.body;
    
    const result = await adminService.updateUserRole(userId, action, req.user._id);

    const io = req.app.get('socketio');
    if (io) {
      io.to(userId.toString()).emit('user_role_updated', { newRole: result.newRole });
    }

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
    
    const io = req.app.get('socketio');
    if (io) {
      io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
    }

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

    const io = req.app.get('socketio');
    if (io) {
      io.to(result.driver._id.toString()).emit('subscription_validated', {
        daysAdded: result.daysToAdd,
        expiresAt: result.newExpiryDate
      });
    }

    await notificationService.sendPushNotification(
      result.driver._id.toString(),
      "Abonnement Active",
      "Votre preuve de paiement a ete validee. Vous pouvez reprendre les courses.",
      { type: 'SUBSCRIPTION_APPROVED' }
    );

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} approved by ${req.user.email}`);
    return successResponse(res, { status: 'APPROVED' }, 'Transaction approuvee.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

const rejectTransaction = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const result = await adminService.rejectTransaction(req.params.id, reason, req.user._id);

    const io = req.app.get('socketio');
    if (io) {
      io.to(result.driver._id.toString()).emit('subscription_rejected', { reason });
    }

    await notificationService.sendPushNotification(
      result.driver._id.toString(),
      "Paiement Rejete",
      `Votre preuve a ete refusee: ${reason}. Veuillez soumettre une image valide.`,
      { type: 'SUBSCRIPTION_REJECTED' }
    );

    logger.info(`[AUDIT FINANCE] Transaction ${result.transaction._id} rejected by ${req.user.email}`);
    return successResponse(res, { status: 'REJECTED' }, 'Transaction rejetee.');

  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};

/**
 * @desc Get Validation Queue (Correction Filtres et Population)
 */
const getValidationQueue = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 10;
    const skip = (page - 1) * limit;

    const filter = { status: 'PENDING' };

    // Isolation stricte: Un simple admin ne voit que ses assignations
    if (req.user.role !== 'superadmin') {
      filter.assignedTo = req.user._id;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('user', 'name phone email currentLocation')
        .populate('assignedTo', 'name email') // Extraction du nom du moderateur en charge
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

const togglePromo = async (req, res) => {
  try {
    const result = await adminService.togglePromo(req.body.isActive, req.user._id);
    return successResponse(res, result, "Statut promo mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const updateWaveLinks = async (req, res) => {
  try {
    const { weeklyLink, monthlyLink } = req.body;
    const result = await adminService.updateWaveLinks(weeklyLink, monthlyLink, req.user._id);
    return successResponse(res, result, "Liens Wave mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
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
  updateWaveLinks
};