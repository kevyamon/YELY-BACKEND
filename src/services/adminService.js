// src/services/adminService.js
// LOGIQUE MÉTIER ADMIN - Gestion Rôles, Bans, Transactions & Lectures
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const Ride = require('../models/Ride');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');

/**
 * Mise à jour du rôle utilisateur (SuperAdmin only)
 */
const updateUserRole = async (userId, action, requesterId, session) => {
  if (userId === requesterId.toString()) {
    throw new AppError('Auto-modification interdite.', 403);
  }

  const user = await User.findById(userId).session(session);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  
  if (user.role === 'superadmin') {
    throw new AppError('Action impossible sur le SuperAdmin.', 403);
  }

  const validTransitions = {
    'PROMOTE': { from: ['rider', 'driver'], to: 'admin' },
    'REVOKE': { from: ['admin'], to: 'rider' }
  };

  if (!validTransitions[action]) throw new AppError('Action invalide (PROMOTE ou REVOKE).', 400);

  const transition = validTransitions[action];
  if (!transition.from.includes(user.role)) {
    throw new AppError(`Transition impossible depuis ${user.role}.`, 400);
  }

  const oldRole = user.role;
  user.role = transition.to;
  await user.save({ session });

  return { user, oldRole, newRole: transition.to };
};

/**
 * Bannir / Débannir un utilisateur
 */
const toggleUserBan = async (userId, reason) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  if (user.role === 'superadmin') throw new AppError('Action impossible sur le SuperAdmin.', 403);

  user.isBanned = !user.isBanned;
  user.banReason = user.isBanned ? (reason || 'Non spécifiée') : '';
  if (user.isBanned) user.isAvailable = false;
  
  await user.save();
  return user;
};

/**
 * Mettre à jour les paramètres de la carte
 */
const updateMapSettings = async (settingsData, userId) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();

  settings.isMapLocked = settingsData.isMapLocked;
  settings.serviceCity = settingsData.serviceCity.trim();
  settings.allowedRadiusKm = settingsData.radius;
  settings.updatedBy = userId;

  if (settingsData.allowedCenter) {
    settings.allowedCenter = {
      type: 'Point',
      coordinates: settingsData.allowedCenter.coordinates
    };
  }

  await settings.save();
  return settings;
};

/**
 * Approuver une transaction
 */
const approveTransaction = async (transactionId, validatorId, session) => {
  const transaction = await Transaction.findOne({ _id: transactionId, status: 'PENDING' }).session(session);
  if (!transaction) throw new AppError('Transaction introuvable ou déjà traitée.', 404);

  const driver = await User.findById(transaction.driver).session(session);
  if (!driver) throw new AppError('Chauffeur introuvable.', 404);

  const hoursToAdd = transaction.type === 'WEEKLY' ? 168 : 720;

  driver.subscription.isActive = true;
  driver.subscription.hoursRemaining += hoursToAdd;
  driver.subscription.lastCheckTime = new Date();
  await driver.save({ session });

  transaction.status = 'APPROVED';
  transaction.validatedBy = validatorId;
  transaction.validatedAt = new Date();
  await transaction.save({ session });

  return { transaction, driver, hoursToAdd, proofPublicId: transaction.proofPublicId };
};

/**
 * Rejeter une transaction
 */
const rejectTransaction = async (transactionId, reason, validatorId) => {
  const transaction = await Transaction.findOne({ _id: transactionId, status: 'PENDING' });
  if (!transaction) throw new AppError('Transaction introuvable ou déjà traitée.', 404);

  transaction.status = 'REJECTED';
  transaction.rejectionReason = reason;
  transaction.validatedBy = validatorId;
  transaction.validatedAt = new Date();
  await transaction.save();

  return { transaction, proofPublicId: transaction.proofPublicId };
};

// ---------------------------------------------------------
// NOUVEAUX AJOUTS (POUR CORRIGER L'ERREUR DE MODULE MANQUANT)
// ---------------------------------------------------------

/**
 * Statistiques Dashboard
 */
const getDashboardStats = async () => {
  const totalUsers = await User.countDocuments();
  const totalDrivers = await User.countDocuments({ role: 'driver' });
  const activeDrivers = await User.countDocuments({ role: 'driver', isAvailable: true });
  const pendingTransactions = await Transaction.countDocuments({ status: 'PENDING' });

  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const ridesToday = await Ride.countDocuments({ createdAt: { $gte: todayStart } });

  return {
    users: { total: totalUsers, drivers: totalDrivers, active: activeDrivers },
    business: { pendingTransactions, ridesToday }
  };
};

/**
 * Liste de tous les utilisateurs (Filtres & Pagination)
 */
const getAllUsers = async (query, userRole) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  
  // Admin ne voit pas superadmin
  if (userRole === 'admin') {
    filter.role = { $ne: 'superadmin' };
  }
  
  if (query.role && ['rider', 'driver', 'admin'].includes(query.role)) {
    filter.role = query.role;
  }
  
  if (query.isBanned === 'true') {
    filter.isBanned = true;
  }

  if (query.search) {
    const searchRegex = new RegExp(query.search.trim(), 'i');
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

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

module.exports = {
  updateUserRole,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getDashboardStats, // ✅ Ajouté
  getAllUsers       // ✅ Ajouté
};