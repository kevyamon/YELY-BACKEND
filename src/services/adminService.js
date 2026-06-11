// src/services/adminService.js
// LOGIQUE DE GOUVERNANCE - Diagnostics d'erreurs stricts et precis
// STANDARD: Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const AuditLog = require('../models/AuditLog');
const Ride = require('../models/Ride');
const AppError = require('../utils/AppError');
const mongoose = require('mongoose');
const redisClient = require('../config/redis');

// Import des modules configurés
const adminConfigService = require('./adminConfigService');

const logSystemAction = async (actorId, action, targetId, details) => {
  try {
    await AuditLog.create({
      actor: actorId,
      action,
      target: targetId,
      details
    });
  } catch (error) {
    console.error(`[AUDIT ERROR] Echec d'ecriture du log (${action}):`, error.message);
  }
};

const updateUserRole = async (userId, action, requesterId) => {
  if (userId === requesterId.toString()) throw new AppError('Auto-promotion interdite.', 403);

  const user = await User.findById(userId);
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
  let targetRole;

  if (action === 'PROMOTE') {
    user.previousRole = oldRole; 
    targetRole = 'admin';
  } else if (action === 'REVOKE') {
    targetRole = user.previousRole || 'rider'; 
    user.previousRole = null; 
  }

  user.role = targetRole;
  await user.save();

  await logSystemAction(requesterId, `${action}_USER`, user._id, `De ${oldRole} vers ${user.role}`);
  try { await redisClient.del(`auth:user:${user._id}`); } catch(e) {}
  
  return { email: user.email, newRole: user.role, action };
};

const toggleUserBan = async (userId, reason, requesterId) => {
  const user = await User.findById(userId);
  if (!user || user.role === 'superadmin') throw new AppError('Action impossible.', 403);

  user.isBanned = !user.isBanned;
  user.banReason = user.isBanned ? reason : '';
  if (user.isBanned) user.isAvailable = false;
  await user.save();

  await logSystemAction(requesterId, user.isBanned ? 'BAN_USER' : 'UNBAN_USER', user._id, reason);
  try { await redisClient.del(`auth:user:${user._id}`); } catch(e) {}
  
  return user;
};

const updateMapSettings = async (data, requesterId) => {
  let settings = await Settings.findOne();
  if (!settings) settings = new Settings();

  settings.isMapLocked = data.isMapLocked;
  settings.serviceCity = data.serviceCity;
  settings.allowedRadiusKm = data.allowedRadiusKm || data.radius;
  settings.allowedCenter = { type: 'Point', coordinates: data.allowedCenter.coordinates };
  settings.updatedBy = requesterId;

  await settings.save();
  await logSystemAction(requesterId, 'UPDATE_MAP_SETTINGS', settings._id, `Ville: ${data.serviceCity}`);
  
  return settings;
};

const approveTransaction = async (transactionId, validatorId) => {
  const cleanId = transactionId.toString().trim();
  const transaction = await Transaction.findById(cleanId);
  
  if (!transaction) {
    throw new AppError('Transaction introuvable dans la base de données.', 404);
  }

  if (transaction.status !== 'PENDING') {
    throw new AppError(`Action impossible : Cette transaction est déjà ${transaction.status}. Veuillez rafraîchir.`, 400);
  }

  const driver = await User.findById(transaction.user);
  if (!driver) throw new AppError('Utilisateur introuvable.', 404);

  const daysToAdd = transaction.planId === 'WEEKLY' ? 7 : 30;
  
  if (!driver.subscription) driver.subscription = {};
  
  let newExpiryDate = new Date();
  if (driver.subscription.expiresAt && driver.subscription.expiresAt > new Date()) {
    newExpiryDate = new Date(driver.subscription.expiresAt);
  }
  newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

  driver.subscription.expiresAt = newExpiryDate;
  driver.subscription.lastCheckTime = new Date();
  
  if (typeof driver.syncSubscription === 'function') {
    driver.syncSubscription();
  } else {
    driver.subscription.isActive = true;
    driver.subscription.hoursRemaining = Math.ceil((newExpiryDate - new Date()) / (1000 * 60 * 60));
  }

  await driver.save();

  transaction.status = 'APPROVED';
  transaction.validatedBy = validatorId;
  transaction.auditLog.push({
    action: 'APPROVAL',
    note: `Preuve validée par l'admin ${validatorId}. Accès prolongé de ${daysToAdd} jours.`
  });
  await transaction.save();

  const details = `Transaction [${transaction._id}] de ${transaction.amount} FCFA validée. +${daysToAdd} jours ajoutés pour ${driver.email}`;
  await logSystemAction(validatorId, 'APPROVE_SUBSCRIPTION', driver._id, details);
  try { await redisClient.del(`auth:user:${driver._id}`); } catch(e) {}

  return { transaction, driver, daysToAdd, newExpiryDate };
};

const rejectTransaction = async (transactionId, reason, validatorId) => {
  const cleanId = transactionId.toString().trim();
  const transaction = await Transaction.findById(cleanId);
  
  if (!transaction) {
    throw new AppError('Transaction introuvable dans la base de données.', 404);
  }

  if (transaction.status !== 'PENDING') {
    throw new AppError(`Action impossible : Cette transaction est déjà ${transaction.status}. Veuillez rafraîchir.`, 400);
  }

  transaction.status = 'REJECTED';
  transaction.validatedBy = validatorId;
  transaction.auditLog.push({
    action: 'REJECTION',
    note: `Preuve rejetée par l'admin ${validatorId}. Motif: ${reason}`
  });
  await transaction.save();

  const driver = await User.findById(transaction.user);
  
  if (driver) {
    if (!driver.subscription) driver.subscription = {};
    driver.subscription.isActive = false;
    driver.subscription.hoursRemaining = 0;
    driver.subscription.expiresAt = null; 
    
    await driver.save();

    const details = `Transaction [${transaction._id}] de ${transaction.amount} FCFA rejetée. Motif: ${reason}`;
    await logSystemAction(validatorId, 'REJECT_SUBSCRIPTION', driver._id, details);
    
    try { await redisClient.del(`auth:user:${driver._id}`); } catch(e) {}
  } else {
    await logSystemAction(validatorId, 'REJECT_SUBSCRIPTION', transaction.user, `Transaction [${transaction._id}] rejetee (Chauffeur introuvable). Motif: ${reason}`);
  }
  
  return { transaction, driver };
};

const getAllUsers = async (query, userRole, requesterId) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = { _id: { $ne: requesterId } };
  
  if (userRole === 'admin') filter.role = { $ne: 'superadmin' };

  if (query.role) {
    filter.role = query.role;
  }
  
  if (query.search) {
    const safeSearch = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(safeSearch, 'i') },
      { email: new RegExp(safeSearch, 'i') },
      { role: new RegExp(safeSearch, 'i') } 
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);

  return { users, pagination: { page, total, pages: Math.ceil(total / limit) } };
};

const getAllRidesHistory = async (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, parseInt(query.limit) || 20);
  const skip = (page - 1) * limit;
  const isArchived = query.isArchived === 'true';

  const filter = { isArchivedByAdmin: isArchived };

  const [rides, total] = await Promise.all([
    Ride.find(filter)
      .populate('driver', 'name phone')
      .populate('rider', 'name phone')
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit)
      .lean(),
    Ride.countDocuments(filter)
  ]);

  return { rides, pagination: { page, total, pages: Math.ceil(total / limit) } };
};

const toggleRideArchive = async (rideId, requesterId) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new AppError('Course introuvable.', 404);
  
  ride.isArchivedByAdmin = !ride.isArchivedByAdmin;
  await ride.save();
  
  await logSystemAction(requesterId, 'TOGGLE_RIDE_ARCHIVE', ride._id, `Archive statut: ${ride.isArchivedByAdmin}`);
  return ride;
};

module.exports = {
  // Re-exports pour retrocompatibilité
  getDashboardStats: adminConfigService.getDashboardStats,
  getFinanceData: adminConfigService.getFinanceData,
  togglePromo: adminConfigService.togglePromo,
  updateWaveLinks: adminConfigService.updateWaveLinks,
  toggleGlobalFreeAccess: adminConfigService.toggleGlobalFreeAccess,

  // Core Service Methods
  updateUserRole,
  toggleUserBan,
  updateMapSettings,
  approveTransaction,
  rejectTransaction,
  getAllUsers,
  getAllRidesHistory,
  toggleRideArchive
};