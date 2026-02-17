// src/services/adminService.js
// LOGIQUE DE GOUVERNANCE - Transactions ACID & Invalidation Cache Dynamique
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');
const redisClient = require('../config/redis'); // 🔌 IMPORT REDIS POUR INVALIDATION

const logSystemAction = async (actorId, action, targetId, details, session) => {
  await AuditLog.create([{
    actor: actorId,
    action,
    target: targetId,
    details
  }], { session });
};

const updateUserRole = async (userId, action, requesterId, session) => {
  if (userId === requesterId.toString()) throw new AppError('Auto-promotion interdite.', 403);

  const user = await User.findById(userId).session(session);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  if (user.role === 'superadmin') throw new AppError('Le SuperAdmin est intouchable.', 403);

  const transitions = {
    'PROMOTE': { from: ['rider', 'driver'], to: 'admin' },
    'REVOKE': { from: ['admin'], to: 'rider' }
  };

  if (!transitions[action].from.includes(user.role)) {
    throw new AppError(`Action impossible sur un profil ${user.role}.`, 400);
  }

  const oldRole = user.role;
  user.role = transitions[action].to;
  await user.save({ session });

  await logSystemAction(requesterId, `${action}_USER`, user._id, `De ${oldRole} vers ${user.role}`, session);
  
  // 🛡️ SÉCURITÉ : Invalidation immédiate des permissions en cache
  await redisClient.del(`auth:user:${user._id}`);
  
  return { email: user.email, newRole: user.role };
};

const toggleUserBan = async (userId, reason, requesterId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(userId).session(session);
    if (!user || user.role === 'superadmin') throw new AppError('Action impossible.', 403);

    user.isBanned = !user.isBanned;
    user.banReason = user.isBanned ? reason : '';
    if (user.isBanned) user.isAvailable = false;
    await user.save({ session });

    await logSystemAction(requesterId, user.isBanned ? 'BAN_USER' : 'UNBAN_USER', user._id, reason, session);
    await session.commitTransaction();
    
    // 🛡️ SÉCURITÉ : Kick immédiat du cache après validation transaction
    await redisClient.del(`auth:user:${user._id}`);
    
    return user;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const updateMapSettings = async (data, requesterId) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let settings = await Settings.findOne().session(session);
    if (!settings) settings = new Settings();

    settings.isMapLocked = data.isMapLocked;
    settings.serviceCity = data.serviceCity;
    settings.allowedRadiusKm = data.radius;
    settings.allowedCenter = { type: 'Point', coordinates: data.allowedCenter.coordinates };
    settings.updatedBy = requesterId;

    await settings.save({ session });
    await logSystemAction(requesterId, 'UPDATE_MAP_SETTINGS', settings._id, `Ville: ${data.serviceCity}`, session);
    
    await session.commitTransaction();
    return settings;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const approveTransaction = async (transactionId, validatorId, session) => {
  const transaction = await Transaction.findOne({ _id: transactionId, status: 'PENDING' }).session(session);
  if (!transaction) throw new AppError('Transaction invalide ou déjà traitée.', 404);

  const driver = await User.findById(transaction.driver).session(session);
  if (!driver) throw new AppError('Chauffeur introuvable.', 404);

  const hoursToAdd = transaction.type === 'WEEKLY' ? 168 : 720;
  driver.subscription.isActive = true;
  driver.subscription.hoursRemaining += hoursToAdd;
  await driver.save({ session });

  transaction.status = 'APPROVED';
  transaction.validatedBy = validatorId;
  await transaction.save({ session });

  await logSystemAction(validatorId, 'APPROVE_PAYMENT', transaction._id, `+${hoursToAdd}h pour ${driver.email}`, session);
  return { transaction, driver, hoursToAdd };
};

const getAllUsers = async (query, userRole) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {};
  if (userRole === 'admin') filter.role = { $ne: 'superadmin' };
  
  if (query.search) {
    const safeSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(safeSearch, 'i') },
      { email: new RegExp(safeSearch, 'i') }
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);

  return { users, pagination: { page, total, pages: Math.ceil(total / limit) } };
};

module.exports = {
  updateUserRole,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  getAllUsers
};