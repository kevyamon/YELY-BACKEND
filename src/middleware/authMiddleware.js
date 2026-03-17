// src/middleware/authMiddleware.js
// AUTHENTIFICATION FORTERESSE - Validation ObjectId, RBAC, Anti-tampering, Blacklist
// STANDARD: Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { verifyAccessToken, hashToken, cleanTokenString } = require('../utils/tokenService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && 
         new mongoose.Types.ObjectId(id).toString() === id;
};

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AppError('Vous n\'êtes pas connecté. Veuillez vous connecter.', 401);
    }

    const cleanToken = cleanTokenString(token);
    const hashedToken = hashToken(cleanToken);

    const isBlacklisted = await TokenBlacklist.exists({ token: hashedToken });
    if (isBlacklisted) {
      logger.warn(`[AUTH SECURITY] Tentative d'utilisation d'un token révoqué - IP: ${req.ip}`);
      throw new AppError('Session expirée ou révoquée. Veuillez vous reconnecter.', 401);
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') throw new AppError('Votre session a expiré. Veuillez vous reconnecter.', 401);
      throw new AppError('Token invalide.', 401);
    }

    if (!isValidObjectId(decoded.userId)) {
      logger.warn(`[AUTH SECURITY] ObjectId malformé détecté: ${decoded.userId} - IP: ${req.ip}`);
      throw new AppError('Token corrompu.', 401);
    }

    const user = await User.findById(decoded.userId).select('-password -__v').lean();
      
    if (!user) {
      throw new AppError('L\'utilisateur appartenant à ce token n\'existe plus.', 401);
    }

    if (user.isBanned) {
      logger.warn(`[AUTH BAN] Tentative accès par utilisateur banni: ${user.email}`);
      throw new AppError(`Compte suspendu: ${user.banReason || 'Raison non spécifiée'}`, 403);
    }

    if (decoded.role && decoded.role !== user.role) {
      logger.info(`[AUTH SYNC] Rôle Token différent de la DB pour ${user.email}.`);
    }

    req.user = user;
    next();

  } catch (error) {
    next(error);
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.warn(`[AUTH FORBIDDEN] ${req.user.email} (${req.user.role}) a tenté d'accéder à une route ${roles.join('/')}`);
      return next(new AppError('Vous n\'avez pas la permission d\'effectuer cette action.', 403));
    }
    next();
  };
};

const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return next();

    const cleanToken = cleanTokenString(token);
    const hashedToken = hashToken(cleanToken);
    
    const isBlacklisted = await TokenBlacklist.exists({ token: hashedToken });
    if (isBlacklisted) return next();

    const decoded = verifyAccessToken(token);
    
    // VERIFICATION AJOUTEE : On protège la base de données contre les identifiants malformés
    if (!isValidObjectId(decoded.userId)) {
      return next();
    }

    const user = await User.findById(decoded.userId).select('name email role isBanned').lean();

    if (user && !user.isBanned) {
      req.user = user;
    }
    next();
  } catch (error) {
    next(); 
  }
};

module.exports = { 
  protect, 
  authorize, 
  optionalAuth,
  isValidObjectId 
};