// src/services/authService.js
// SERVICE AUTH - Logique Métier & Transactions ACID
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');

/**
 * Normalisation interne des données utilisateur
 */
const normalizeUserData = (data) => ({
  name: data.name?.trim(),
  email: data.email?.toLowerCase().trim(),
  phone: data.phone?.replace(/\s/g, ''),
  password: data.password,
  role: data.role
});

/**
 * Inscription avec transaction isolée
 */
const register = async (rawUserData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userData = normalizeUserData(rawUserData);

    // Vérification existence
    const existing = await User.findOne({
      $or: [{ email: userData.email }, { phone: userData.phone }]
    }).session(session);

    if (existing) throw new AppError('Cet email ou ce numéro est déjà utilisé.', 409);

    // Sécurité Rôles
    if (['admin', 'superadmin'].includes(userData.role)) {
      throw new AppError('Action non autorisée.', 403);
    }

    const [user] = await User.create([userData], { session });
    await session.commitTransaction();
    return user;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Authentification et vérification de compte
 */
const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  const user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) {
    throw new AppError(`Compte suspendu: ${user.banReason}`, 403);
  }

  return user;
};

/**
 * Logique de validation de session pour rafraîchissement
 */
const validateSessionForRefresh = async (token) => {
  const decoded = await verifyRefreshToken(token);
  
  const user = await User.findById(decoded.userId);
  if (!user || user.isBanned) {
    throw new AppError('Session invalide ou utilisateur banni.', 403);
  }

  return user;
};

/**
 * Mise à jour de disponibilité
 */
const updateAvailability = async (userId, isAvailable) => {
  const user = await User.findByIdAndUpdate(
    userId,
    { isAvailable },
    { new: true, runValidators: true }
  ).select('isAvailable');

  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  return user;
};

module.exports = {
  register,
  login,
  validateSessionForRefresh,
  updateAvailability
};