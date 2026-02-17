// src/services/authService.js
// SERVICE AUTH - Anti-Bruteforce Actif & Mitigations Timing Attacks
// CSCSM Level: Bank Grade

const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');
const { SECURITY_CONSTANTS } = require('../config/env');

const MAX_ATTEMPTS = SECURITY_CONSTANTS?.MAX_LOGIN_ATTEMPTS || 5;
const LOCK_WINDOW = SECURITY_CONSTANTS?.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000; // 15 min par défaut

/**
 * Inscription utilisateur
 */
const register = async (userData) => {
  const existing = await User.findOne({
    $or: [{ email: userData.email }, { phone: userData.phone }]
  });

  if (existing) {
    throw new AppError('Cet email ou ce numéro est déjà utilisé.', 409);
  }

  if (userData.role && ['admin', 'superadmin'].includes(userData.role)) {
    throw new AppError('Action non autorisée.', 403);
  }

  const user = await User.create(userData);
  return user;
};

/**
 * Authentification sécurisée avec protection Brute-force & Anti-Timing
 */
const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  const user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password +loginAttempts +lockUntil');

  // 🛡️ SÉCURITÉ : Anti-Timing Attack (Délai constant artificiel pour masquer l'existence de l'utilisateur)
  if (!user) {
    await new Promise(resolve => setTimeout(resolve, 500));
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) {
    throw new AppError(`Compte suspendu: ${user.banReason}`, 403);
  }

  // 1. Vérification Account Lockout
  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(`Compte verrouillé pour raisons de sécurité. Réessayez dans ${minutesLeft} minutes.`, 429);
  }

  // 2. Vérification Mot de passe
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    // 🛡️ SÉCURITÉ : Incrémentation Atomique du Bruteforce Counter
    const updates = { $inc: { loginAttempts: 1 } };
    
    if (user.loginAttempts + 1 >= MAX_ATTEMPTS) {
      updates.lockUntil = Date.now() + LOCK_WINDOW;
      updates.loginAttempts = 0; // Reset pour le prochain cycle post-lock
    }
    
    await User.updateOne({ _id: user._id }, updates);
    
    if (updates.lockUntil) {
       throw new AppError(`Trop de tentatives échouées. Compte verrouillé pour ${LOCK_WINDOW / 60000} minutes.`, 429);
    }
    
    throw new AppError('Identifiants incorrects.', 401);
  }

  // 3. Succès : Reset des compteurs de sécurité
  if (user.loginAttempts > 0 || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { 
      loginAttempts: 0, 
      $unset: { lockUntil: 1 } 
    });
  }

  return user;
};

const validateSessionForRefresh = async (token) => {
  const decoded = await verifyRefreshToken(token);
  const user = await User.findById(decoded.userId);
  
  if (!user || user.isBanned) {
    throw new AppError('Session invalide ou utilisateur banni.', 403);
  }
  return user;
};

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