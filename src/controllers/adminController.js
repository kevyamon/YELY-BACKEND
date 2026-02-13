// src/controllers/adminController.js
// CONTRÔLEUR ADMIN - Validation stricte, Transactions, Audit complet
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const cloudinary = require('../config/cloudinary');
const mongoose = require('mongoose');

// Messages métier
const ADMIN_MESSAGES = {
  ROLE_UPDATED: 'Rôle mis à jour.',
  BAN_TOGGLED: 'Statut de bannissement modifié.',
  SETTINGS_UPDATED: 'Paramètres mis à jour.',
  TRANSACTION_APPROVED: 'Transaction approuvée.',
  TRANSACTION_REJECTED: 'Transaction rejetée.',
  INVALID_USER_ID: 'ID utilisateur invalide.',
  USER_NOT_FOUND: 'Utilisateur introuvable.',
  SUPERADMIN_PROTECTED: 'Action impossible sur le SuperAdmin.',
  SERVER_ERROR: 'Erreur lors du traitement.'
};

/**
 * @desc Promouvoir/Rétrograder un utilisateur (SuperAdmin only)
 * @route POST /api/admin/update-role
 */
exports.updateAdminStatus = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { userId, action } = req.body;

    // Validation ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: ADMIN_MESSAGES.INVALID_USER_ID,
        code: 'INVALID_USER_ID'
      });
    }

    // Protection SuperAdmin
    if (userId === req.user._id) {
      return res.status(403).json({
        success: false,
        message: 'Auto-modification interdite.',
        code: 'SELF_MODIFY_FORBIDDEN'
      });
    }

    const result = await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      if (user.role === 'superadmin') {
        throw new Error('SUPERADMIN_PROTECTED');
      }

      // Transition de rôle valide
      const validTransitions = {
        'PROMOTE': { from: ['rider', 'driver'], to: 'admin' },
        'REVOKE': { from: ['admin'], to: 'rider' }
      };

      if (!validTransitions[action]) {
        throw new Error('INVALID_ACTION');
      }

      const transition = validTransitions[action];
      if (!transition.from.includes(user.role)) {
        throw new Error('INVALID_TRANSITION');
      }

      const oldRole = user.role;
      user.role = transition.to;
      await user.save({ session });

      // Log audit
      console.log(`[AUDIT] Role change: ${req.user.email} changed ${user.email} from ${oldRole} to ${transition.to}`);

      return { user, oldRole, newRole: transition.to };
    });

    res.json({
      success: true,
      data: {
        userId: result.user._id,
        oldRole: result.oldRole,
        newRole: result.newRole
      },
      message: ADMIN_MESSAGES.ROLE_UPDATED
    });

  } catch (error) {
    const businessErrors = {
      'USER_NOT_FOUND': { status: 404, message: ADMIN_MESSAGES.USER_NOT_FOUND },
      'SUPERADMIN_PROTECTED': { status: 403, message: ADMIN_MESSAGES.SUPERADMIN_PROTECTED },
      'INVALID_ACTION': { status: 400, message: 'Action invalide (PROMOTE ou REVOKE).' },
      'INVALID_TRANSITION': { status: 400, message: 'Transition de rôle non autorisée.' }
    };

    if (businessErrors[error.message]) {
      const err = businessErrors[error.message];
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: error.message
      });
    }

    console.error('[ADMIN ROLE] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc Bannir/Débannir un utilisateur
 * @route POST /api/admin/toggle-ban
 */
exports.toggleUserBan = async (req, res) => {
  try {
    const { userId, reason } = req.body;

    // Validation
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: ADMIN_MESSAGES.INVALID_USER_ID,
        code: 'INVALID_USER_ID'
      });
    }

    if (reason && reason.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Raison trop longue (500 caractères max).',
        code: 'REASON_TOO_LONG'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: ADMIN_MESSAGES.USER_NOT_FOUND,
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({
        success: false,
        message: ADMIN_MESSAGES.SUPERADMIN_PROTECTED,
        code: 'SUPERADMIN_PROTECTED'
      });
    }

    // Toggle ban
    const wasBanned = user.isBanned;
    user.isBanned = !wasBanned;
    user.banReason = user.isBanned ? (reason || 'Non spécifiée') : '';
    await user.save();

    // Log audit
    console.log(`[AUDIT] Ban ${user.isBanned ? 'applied' : 'lifted'}: ${req.user.email} on ${user.email} (${user.isBanned ? reason : 'lifted'})`);

    res.json({
      success: true,
      data: {
        userId: user._id,
        isBanned: user.isBanned,
        banReason: user.banReason
      },
      message: user.isBanned ? 'Utilisateur banni.' : 'Bannissement levé.'
    });

  } catch (error) {
    console.error('[ADMIN BAN] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Mettre à jour les paramètres de la carte (geofencing)
 * @route POST /api/admin/map-lock
 */
exports.updateMapSettings = async (req, res) => {
  try {
    const { isMapLocked, serviceCity, radius, allowedCenter } = req.body;

    // Validation des entrées
    if (typeof isMapLocked !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isMapLocked doit être true ou false.',
        code: 'INVALID_TYPE'
      });
    }

    if (!serviceCity || typeof serviceCity !== 'string' || serviceCity.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Nom de ville invalide.',
        code: 'INVALID_CITY'
      });
    }

    if (typeof radius !== 'number' || radius < 1 || radius > 100) {
      return res.status(400).json({
        success: false,
        message: 'Rayon invalide (1-100 km).',
        code: 'INVALID_RADIUS'
      });
    }

    // Validation coordonnées si fournies
    let centerCoords = null;
    if (allowedCenter) {
      if (!Array.isArray(allowedCenter.coordinates) || 
          allowedCenter.coordinates.length !== 2 ||
          typeof allowedCenter.coordinates[0] !== 'number' ||
          typeof allowedCenter.coordinates[1] !== 'number') {
        return res.status(400).json({
          success: false,
          message: 'Coordonnées centre invalides.',
          code: 'INVALID_COORDINATES'
        });
      }
      centerCoords = allowedCenter.coordinates;
    }

    // Upsert settings
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    settings.isMapLocked = isMapLocked;
    settings.serviceCity = serviceCity.trim();
    settings.allowedRadiusKm = radius;
    settings.updatedBy = req.user._id;
    
    if (centerCoords) {
      settings.allowedCenter = {
        type: 'Point',
        coordinates: centerCoords
      };
    }
    
    await settings.save();

    // Log audit
    console.log(`[AUDIT] Map settings updated by ${req.user.email}: ${serviceCity}, radius ${radius}km, locked=${isMapLocked}`);

    res.json({
      success: true,
      data: {
        isMapLocked: settings.isMapLocked,
        serviceCity: settings.serviceCity,
        allowedRadiusKm: settings.allowedRadiusKm,
        allowedCenter: settings.allowedCenter
      },
      message: ADMIN_MESSAGES.SETTINGS_UPDATED
    });

  } catch (error) {
    console.error('[ADMIN MAP] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Récupérer la file d'attente des validations
 * @route GET /api/admin/validations
 */
exports.getValidationQueue = async (req, res) => {
  try {
    // Pagination obligatoire
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Filtre selon rôle
    let query = { status: 'PENDING' };
    if (req.user.role === 'admin') {
      query.assignedTo = 'PARTNER';
    }
    // SuperAdmin voit tout

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('driver', 'name phone vehicle subscription')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('[ADMIN QUEUE] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Approuver une transaction (avec crédit abonnement)
 * @route POST /api/admin/approve/:id
 */
exports.approveTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID transaction invalide.',
        code: 'INVALID_ID'
      });
    }

    const result = await session.withTransaction(async () => {
      const transaction = await Transaction.findOne({
        _id: id,
        status: 'PENDING'
      }).session(session);

      if (!transaction) {
        throw new Error('TRANSACTION_NOT_FOUND');
      }

      const driver = await User.findById(transaction.driver).session(session);
      if (!driver) {
        throw new Error('DRIVER_NOT_FOUND');
      }

      // Calcul crédit heures
      const hoursToAdd = transaction.type === 'WEEKLY' ? 168 : 720; // 7j ou 30j

      // Mise à jour atomique driver
      driver.subscription.isActive = true;
      driver.subscription.hoursRemaining += hoursToAdd;
      driver.subscription.lastCheckTime = new Date();
      await driver.save({ session });

      // Mise à jour transaction
      transaction.status = 'APPROVED';
      transaction.validatedBy = req.user._id;
      transaction.validatedAt = new Date();
      await transaction.save({ session });

      // Suppression image Cloudinary (async, non bloquant pour transaction)
      if (transaction.proofPublicId) {
        try {
          await cloudinary.uploader.destroy(transaction.proofPublicId);
        } catch (cloudErr) {
          console.warn('[CLOUDINARY] Échec suppression:', cloudErr.message);
          // Non bloquant
        }
      }

      return { transaction, driver, hoursToAdd };
    });

    // Notification driver (hors transaction)
    const io = req.app.get('socketio');
    io.to(result.driver._id.toString()).emit('subscription_validated', {
      plan: result.transaction.type,
      hoursAdded: result.hoursToAdd,
      totalHours: result.driver.subscription.hoursRemaining
    });

    // Log audit
    console.log(`[AUDIT] Transaction ${id} approved by ${req.user.email} for driver ${result.driver.email}`);

    res.json({
      success: true,
      data: {
        transactionId: result.transaction._id,
        driverId: result.driver._id,
        hoursAdded: result.hoursToAdd,
        newTotal: result.driver.subscription.hoursRemaining
      },
      message: ADMIN_MESSAGES.TRANSACTION_APPROVED
    });

  } catch (error) {
    const businessErrors = {
      'TRANSACTION_NOT_FOUND': { status: 404, message: 'Transaction introuvable ou déjà traitée.' },
      'DRIVER_NOT_FOUND': { status: 404, message: 'Chauffeur introuvable.' }
    };

    if (businessErrors[error.message]) {
      const err = businessErrors[error.message];
      return res.status(err.status).json({
        success: false,
        message: err.message,
        code: error.message
      });
    }

    console.error('[ADMIN APPROVE] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc Rejeter une transaction
 * @route POST /api/admin/reject/:id
 */
exports.rejectTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID transaction invalide.',
        code: 'INVALID_ID'
      });
    }

    if (!reason || reason.length < 5 || reason.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Raison requise (5-500 caractères).',
        code: 'INVALID_REASON'
      });
    }

    const transaction = await Transaction.findOne({
      _id: id,
      status: 'PENDING'
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction introuvable ou déjà traitée.',
        code: 'TRANSACTION_NOT_FOUND'
      });
    }

    transaction.status = 'REJECTED';
    transaction.rejectionReason = reason.trim();
    transaction.validatedBy = req.user._id;
    transaction.validatedAt = new Date();
    await transaction.save();

    // Suppression image
    if (transaction.proofPublicId) {
      try {
        await cloudinary.uploader.destroy(transaction.proofPublicId);
      } catch (cloudErr) {
        console.warn('[CLOUDINARY] Échec suppression:', cloudErr.message);
      }
    }

    // Notification driver
    const io = req.app.get('socketio');
    io.to(transaction.driver.toString()).emit('subscription_rejected', {
      reason: transaction.rejectionReason
    });

    // Log audit
    console.log(`[AUDIT] Transaction ${id} rejected by ${req.user.email}: ${reason}`);

    res.json({
      success: true,
      data: {
        transactionId: transaction._id,
        status: transaction.status,
        reason: transaction.rejectionReason
      },
      message: ADMIN_MESSAGES.TRANSACTION_REJECTED
    });

  } catch (error) {
    console.error('[ADMIN REJECT] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Liste tous les utilisateurs (avec pagination et filtres)
 * @route GET /api/admin/users
 */
exports.getAllUsers = async (req, res) => {
  try {
    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    // Filtres
    const filter = {};
    
    // Admin ne voit pas superadmin
    if (req.user.role === 'admin') {
      filter.role = { $ne: 'superadmin' };
    }
    
    // Filtres optionnels
    if (req.query.role && ['rider', 'driver', 'admin'].includes(req.query.role)) {
      filter.role = req.query.role;
    }
    
    if (req.query.isBanned === 'true') {
      filter.isBanned = true;
    }

    // Recherche texte (nom, email, téléphone)
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search.trim(), 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -__v')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('[ADMIN USERS] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: ADMIN_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};