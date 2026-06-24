const User = require('../models/User');
const Transaction = require('../models/Transaction');
const adminService = require('../services/adminService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

exports.getSubscriptions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = { role: { $in: ['driver', 'seller'] } };

    if (req.query.role) {
      filter.role = req.query.role;
    }

    if (req.query.search) {
      const safeSearch = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(safeSearch, 'i') },
        { email: new RegExp(safeSearch, 'i') },
        { phone: new RegExp(safeSearch, 'i') }
      ];
    }

    const now = new Date();
    if (req.query.status) {
      if (req.query.status === 'active') {
        filter['subscription.isActive'] = true;
        filter['subscription.expiresAt'] = { $gt: now };
        filter.isBanned = false;
      } else if (req.query.status === 'expired') {
        filter.$or = [
          { 'subscription.isActive': false },
          { 'subscription.expiresAt': { $lte: now } },
          { 'subscription.expiresAt': null }
        ];
        filter.isBanned = false;
      } else if (req.query.status === 'banned') {
        filter.isBanned = true;
      }
    }

    // Récupérer les utilisateurs
    const usersList = await User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit);

    // Synchronisation en temps réel de l'état d'abonnement vis-à-vis de l'horloge serveur
    let countChanged = false;
    for (const u of usersList) {
      if (typeof u.syncSubscription === 'function') {
        const changed = u.syncSubscription();
        if (changed) {
          await u.save({ validateBeforeSave: false });
          countChanged = true;
        }
      }
    }

    // Si des modifications ont eu lieu, on recharge la liste pour renvoyer des informations fraîches
    const users = countChanged 
      ? await User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
      : usersList.map(u => u.toObject());

    const total = await User.countDocuments(filter);

    return successResponse(res, {
      users,
      pagination: { page, total, pages: Math.ceil(total / limit) }
    }, 'Abonnements récupérés avec succès.');
  } catch (error) {
    logger.error(`[ADMIN SUBSCRIPTIONS] Error: ${error.message}`);
    return errorResponse(res, 'Impossible de récupérer la liste des abonnements.', 500);
  }
};

exports.getSubscriptionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const transactions = await Transaction.find({ user: userId })
      .populate('assignedTo', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return successResponse(res, transactions, 'Historique des transactions récupéré.');
  } catch (error) {
    logger.error(`[ADMIN SUBSCRIPTIONS HISTORY] Error: ${error.message}`);
    return errorResponse(res, "Impossible de récupérer l'historique d'abonnement.", 500);
  }
};

exports.toggleSubscriptionBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    
    // Sécurité RBAC : Bloquer si la cible est admin/superadmin
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      throw new AppError('Utilisateur introuvable.', 404);
    }
    
    if (req.user.role === 'admin' && (targetUser.role === 'admin' || targetUser.role === 'superadmin')) {
      throw new AppError('Non autorisé : Un administrateur ne peut pas suspendre un autre administrateur.', 403);
    }

    const user = await adminService.toggleUserBan(userId, reason, req.user._id);
    
    try {
      const io = req.app.get('socketio');
      if (io) {
        io.to(userId.toString()).emit(user.isBanned ? 'user_banned' : 'user_unbanned', { reason });
      }
    } catch (e) { 
      logger.warn(`[SOCKET] Échec non-critique : ${e.message}`); 
    }

    logger.warn(`[AUDIT BAN SUBSCRIPTION] ${req.user.email} toggled ban on ${user.email} via Subscription screen.`);
    return successResponse(res, { isBanned: user.isBanned }, user.isBanned ? 'Utilisateur suspendu avec succès.' : 'Suspension levée avec succès.');
  } catch (error) {
    return errorResponse(res, error.message, error.statusCode || 500);
  }
};
