// src/services/authService.js
// SERVICE AUTH - Synchronisation Parfaite & Backdoor Stores (Apple/Google)
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings'); // NOUVEAU: Import des settings
const AppError = require('../utils/AppError');
const { verifyRefreshToken } = require('../utils/tokenService');
const { SECURITY_CONSTANTS } = require('../config/env');
const emailService = require('../utils/emailService');
const bcrypt = require('bcrypt');

const MAX_ATTEMPTS = SECURITY_CONSTANTS?.MAX_LOGIN_ATTEMPTS || 5;
const LOCK_WINDOW = SECURITY_CONSTANTS?.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000;

// NUMERO MAGIQUE POUR LES TESTEURS APPLE/GOOGLE (Correction à 8 zéros)
const STORE_TESTER_PHONE = '+2250000000';

const register = async (userData) => {
  const emailExists = await User.findOne({ email: userData.email, isDeleted: { $ne: true } });
  if (emailExists) throw new AppError('Cette adresse e-mail est deja associee a un compte.', 409);

  const phoneExists = await User.findOne({ phone: userData.phone, isDeleted: { $ne: true } });
  if (phoneExists) throw new AppError('Ce numero de telephone est deja associe a un compte.', 409);

  if (userData.role && ['admin', 'superadmin'].includes(userData.role)) {
    throw new AppError('Action non autorisee.', 403);
  }

  const user = await User.create(userData);
  return user;
};

const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  let user = await User.findOne({
    $or: [{ email: normalizedId }, { phone: normalizedId }]
  }).select('+password +loginAttempts +lockUntil');

  if (!user) {
    await new Promise(resolve => setTimeout(resolve, 500));
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isDeleted) throw new AppError('Ce compte a ete supprime et ne peut plus se connecter.', 403);
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
    if (updates.lockUntil) {
      throw new AppError(`Trop de tentatives echouees. Compte verrouille pour ${LOCK_WINDOW / 60000} minutes.`, 429);
    }
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.loginAttempts > 0 || user.lockUntil) {
    await User.updateOne({ _id: user._id }, { loginAttempts: 0, $unset: { lockUntil: 1 } });
  }

  if (user.role === 'driver') {
    const settings = await Settings.findOne();
    const isGlobalFreeAccess = settings?.isGlobalFreeAccess || false;

    if (user.phone === STORE_TESTER_PHONE || isGlobalFreeAccess) {
      user.subscription = {
        isActive: true,
        expiresAt: new Date('2099-12-31T23:59:59Z'),
        hoursRemaining: 999999,
        plan: 'MONTHLY'
      };
      if (user.phone === STORE_TESTER_PHONE) {
        await User.updateOne({ _id: user._id }, { subscription: user.subscription });
      }
      user = user.toObject();
      user.subscription.isPending = false;
      user.subscription.isGlobalFreeAccess = isGlobalFreeAccess; // Flag pour le frontend
    } else {
      const changed = user.syncSubscription();
      if (changed) {
        await user.save({ validateBeforeSave: false });
      }
      const pendingTx = await Transaction.findOne({ user: user._id, status: 'PENDING' });
      
      user = user.toObject();
      user.subscription = user.subscription || {};
      user.subscription.isPending = !!pendingTx; 
      user.subscription.isGlobalFreeAccess = false;
    }
  } else {
    user = user.toObject();
  }

  return user;
};

const forgotPassword = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  
  if (!user || user.isDeleted) return true; 

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = await bcrypt.hash(otp, 12);

  user.resetPasswordOtp = hashedOtp;
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
  await user.save({ validateBeforeSave: false });

  try {
    await emailService.sendOtpEmail(user.email, otp);
  } catch (error) {
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    throw new AppError("Erreur lors de l'envoi de l'e-mail.", 500);
  }

  return true;
};

const resetPasswordWithOtp = async (email, otp, newPassword) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+resetPasswordOtp +resetPasswordExpires');

  if (!user || user.isDeleted || !user.resetPasswordExpires || user.resetPasswordExpires < Date.now()) {
    throw new AppError('Le code est invalide ou a expire.', 400);
  }

  const isValidOtp = await bcrypt.compare(otp.toString(), user.resetPasswordOtp);
  if (!isValidOtp) {
    throw new AppError('Le code est invalide ou a expire.', 400);
  }

  user.password = newPassword;
  user.resetPasswordOtp = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  return true;
};

const validateSessionForRefresh = async (token) => {
  try {
    const decoded = await verifyRefreshToken(token);
    const userId = decoded.userId || decoded.id || decoded._id || (typeof decoded === 'string' ? decoded : null);
    
    if (!userId) {
      throw new AppError('Structure du jeton illisible.', 401);
    }
    
    let user = await User.findById(userId);
    if (!user) {
      throw new AppError('L\'utilisateur lie a cette session n\'existe plus.', 401);
    }

    if (user.isDeleted) throw new AppError('Session invalide, ce compte est supprime.', 403);
    if (user.isBanned) throw new AppError(`Session revoquee. Compte suspendu: ${user.banReason}`, 403);
    
    if (user.role === 'driver') {
      const settings = await Settings.findOne();
      const isGlobalFreeAccess = settings?.isGlobalFreeAccess || false;

      if (user.phone === STORE_TESTER_PHONE || isGlobalFreeAccess) {
        user.subscription = {
          isActive: true,
          expiresAt: new Date('2099-12-31T23:59:59Z'),
          hoursRemaining: 999999,
          plan: 'MONTHLY'
        };
        user = user.toObject();
        user.subscription.isPending = false;
        user.subscription.isGlobalFreeAccess = isGlobalFreeAccess;
      } else {
        const changed = user.syncSubscription();
        if (changed) {
          await user.save({ validateBeforeSave: false });
        }
        const pendingTx = await Transaction.findOne({ user: user._id, status: 'PENDING' });
        
        user = user.toObject();
        user.subscription = user.subscription || {};
        user.subscription.isPending = !!pendingTx;
        user.subscription.isGlobalFreeAccess = false;
      }
    } else {
      user = user.toObject();
    }

    return user;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError(`Echec de validation de session.`, 401);
  }
};

const updateAvailability = async (userId, isAvailable) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  if (user.isDeleted) throw new AppError('Action impossible sur un compte supprime.', 403);

  user.isAvailable = isAvailable;
  await user.save(); 
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