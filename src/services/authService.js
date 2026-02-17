// src/services/authService.js
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');
const { SECURITY_CONSTANTS } = require('../config/env');

/**
 * Inscription utilisateur
 * Note: Suppression des transactions MongoDB pour compatibilité maximale et stabilité.
 */
const register = async (userData) => {
  // Verification doublons (Email ou Telephone)
  const existing = await User.findOne({
    $or: [{ email: userData.email }, { phone: userData.phone }]
  });

  if (existing) {
    throw new AppError('Cet email ou ce numéro est déjà utilisé.', 409);
  }

  // Protection contre l'elevation de privileges
  if (userData.role && ['admin', 'superadmin'].includes(userData.role)) {
    throw new AppError('Action non autorisée.', 403);
  }

  // Creation directe (Les setters du modele gèrent le nettoyage)
  const user = await User.create(userData);
  return user;
};

/**
 * Authentification securisee avec protection Brute-force
 */
const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  const user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password +loginAttempts +lockUntil');

  if (!user) {
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) {
    throw new AppError(`Compte suspendu: ${user.banReason}`, 403);
  }

  // 1. Verification Account Lockout
  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(`Compte verrouillé. Réessayez dans ${minutesLeft} minutes.`, 429);
  }

  // 2. Verification Mot de passe
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    // Incrementer les tentatives de facon atomique (Plus sûr que save())
    const updates = { $inc: { loginAttempts: 1 } };
    
    if (user.loginAttempts + 1 >= SECURITY_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
      updates.lockUntil = Date.now() + SECURITY_CONSTANTS.RATE_LIMIT_WINDOW_MS;
      // On reinitialise le compteur quand on verrouille pour le prochain cycle
      updates.loginAttempts = 0; 
    }
    
    await User.updateOne({ _id: user._id }, updates);
    
    if (updates.lockUntil) {
       throw new AppError(`Trop de tentatives. Compte verrouillé pour ${SECURITY_CONSTANTS.RATE_LIMIT_WINDOW_MS / 60000} minutes.`, 429);
    }
    
    throw new AppError('Identifiants incorrects.', 401);
  }

  // 3. Succes : Reset des compteurs si necessaire
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