// src/services/authService.js
// SERVICE AUTH - Anti-Bruteforce Actif & Mitigations Timing Attacks
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');
const { SECURITY_CONSTANTS } = require('../config/env');
const emailService = require('../utils/emailService');
const bcrypt = require('bcrypt');

const MAX_ATTEMPTS = SECURITY_CONSTANTS?.MAX_LOGIN_ATTEMPTS || 5;
const LOCK_WINDOW = SECURITY_CONSTANTS?.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000;

const register = async (userData) => {
  const existing = await User.findOne({
    $or: [{ email: userData.email }, { phone: userData.phone }]
  });

  if (existing) throw new AppError('Cet email ou ce numero est deja utilise.', 409);
  if (userData.role && ['admin', 'superadmin'].includes(userData.role)) throw new AppError('Action non autorisee.', 403);

  const user = await User.create(userData);
  return user;
};

const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  const user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password +loginAttempts +lockUntil');

  if (!user) {
    await new Promise(resolve => setTimeout(resolve, 500));
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) throw new AppError(`Compte suspendu: ${user.banReason}`, 403);

  if (user.lockUntil && user.lockUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    throw new AppError(`Compte verrouille pour raisons de securite. Reessayez dans ${minutesLeft} minutes.`, 429);
  }

  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    const updates = { $inc: { loginAttempts: 1 } };
    if (user.loginAttempts + 1 >= MAX_ATTEMPTS) {
      updates.lockUntil = Date.now() + LOCK_WINDOW;
      updates.loginAttempts = 0; 
    }
    await User.updateOne({ _id: user._id }, updates);
    if (updates.lockUntil) throw new AppError(`Trop de tentatives echouees. Compte verrouille pour ${LOCK_WINDOW / 60000} minutes.`, 429);
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.loginAttempts > 0 || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { loginAttempts: 0, $unset: { lockUntil: 1 } });
  }

  if (typeof user.syncSubscription === 'function' && user.syncSubscription()) {
    await User.updateOne({ _id: user._id }, { $set: { subscription: user.subscription } });
  }

  return user;
};

// =========================================================================
// NOUVEAUTÉ : GESTION DES MOTS DE PASSE (OTP)
// =========================================================================

const forgotPassword = async (email) => {
  console.log(`[DEBUG - SERVICE] Recherche de l'utilisateur avec l'email: ${email}`);
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  
  // DÉBOGAGE : On désactive le return true silencieux. On veut VOIR l'erreur.
  if (!user) {
    console.log(`[DEBUG - SERVICE] ÉCHEC: Utilisateur introuvable pour ${email}`);
    throw new AppError("DEBUG: Utilisateur introuvable en base de données.", 404);
  } 

  console.log(`[DEBUG - SERVICE] Utilisateur trouvé, génération OTP...`);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 12);

  user.resetPasswordOtp = hashedOtp;
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
  await user.save({ validateBeforeSave: false });
  
  console.log(`[DEBUG - SERVICE] OTP généré et sauvegardé. Appel de emailService...`);

  try {
    await emailService.sendOtpEmail(user.email, otp);
    console.log(`[DEBUG - SERVICE] Succès: emailService n'a pas renvoyé d'erreur.`);
  } catch (error) {
    console.error(`[DEBUG - SERVICE] Erreur renvoyée par emailService:`, error);
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    throw new AppError("Erreur lors de l'envoi de l'email.", 500);
  }

  return true;
};

const resetPasswordWithOtp = async (email, otp, newPassword) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+resetPasswordOtp +resetPasswordExpires');

  if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
    throw new AppError('Le code est invalide ou a expiré.', 400);
  }

  const isValidOtp = await bcrypt.compare(otp.toString(), user.resetPasswordOtp);
  if (!isValidOtp) {
    throw new AppError('Le code est invalide ou a expiré.', 400);
  }

  // Si le code est bon, on change le mot de passe (le hook 'pre-save' du modèle le hachera automatiquement)
  user.password = newPassword;
  user.resetPasswordOtp = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  return true;
};

// =========================================================================

const validateSessionForRefresh = async (token) => {
  try {
    const decoded = await verifyRefreshToken(token);
    const userId = decoded.userId || decoded.id || decoded._id || (typeof decoded === 'string' ? decoded : null);
    if (!userId) throw new AppError('Structure du token illisible.', 401);
    
    const user = await User.findById(userId);
    if (!user) throw new AppError('L\'utilisateur lie a cette session n\'existe plus.', 401);
    if (user.isBanned) throw new AppError(`Session revoquee. Compte suspendu: ${user.banReason}`, 403);
    
    if (typeof user.syncSubscription === 'function' && user.syncSubscription()) {
      await User.updateOne({ _id: user._id }, { $set: { subscription: user.subscription } });
    }
    return user;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError(`Echec de validation de session: ${error.message}`, 401);
  }
};

const updateAvailability = async (userId, isAvailable) => {
  const user = await User.findByIdAndUpdate(userId, { isAvailable }, { new: true, runValidators: true }).select('isAvailable');
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  return user;
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPasswordWithOtp,
  validateSessionForRefresh,
  updateAvailability
};