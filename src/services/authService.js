// src/services/authService.js
// SERVICE AUTH - Logique Métier & Transactions ACID
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');
const { SECURITY_CONSTANTS } = require('../config/env'); // ✅ IMPORT DES CONSTANTES DE SÉCURITÉ

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
 * Authentification et vérification de compte avec Account Lockout
 */
const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  // 🚀 On inclut le password ET les données de lockout
  const user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password +loginAttempts +lockUntil');

  if (!user) {
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) {
    throw new AppError(`Compte suspendu: ${user.banReason}`, 403);
  }

  // 🛡️ 1. Vérification du verrouillage temporel (Account Lockout)
  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(`Compte verrouillé suite à de multiples échecs. Réessayez dans ${minutesLeft} minutes.`, 429);
  }

  // 🛡️ 2. Vérification du mot de passe
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    user.loginAttempts += 1;
    
    // Si le nombre maximum de tentatives est atteint, on verrouille le compte
    if (user.loginAttempts >= SECURITY_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
      user.lockUntil = Date.now() + SECURITY_CONSTANTS.RATE_LIMIT_WINDOW_MS; // Par défaut 15 minutes
      await user.save({ validateBeforeSave: false }); // On sauvegarde sans déclencher la validation complète
      throw new AppError(`Trop de tentatives échouées. Compte verrouillé pour ${SECURITY_CONSTANTS.RATE_LIMIT_WINDOW_MS / 60000} minutes.`, 429);
    }
    
    await user.save({ validateBeforeSave: false });
    throw new AppError('Identifiants incorrects.', 401);
  }

  // 🛡️ 3. Succès : Réinitialisation des compteurs de sécurité
  if (user.loginAttempts > 0 || user.lockUntil) {
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save({ validateBeforeSave: false });
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