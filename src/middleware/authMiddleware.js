// src/middleware/authMiddleware.js
// AUTHENTIFICATION FORTERESSE - Validation ObjectId, RBAC, Anti-tampering (Temps Réel)
// STANDARD: Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokenService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * Valide qu'une chaîne est un ObjectId MongoDB valide
 */
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && 
         new mongoose.Types.ObjectId(id).toString() === id;
};

/**
 * Middleware d'authentification principal (Protect)
 */
const protect = async (req, res, next) => {
  try {
    // 1. Extraction Token
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AppError('Vous n\'êtes pas connecté. Veuillez vous connecter.', 401);
    }

    // 2. Vérification Crypto (JWT)
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') throw new AppError('Votre session a expiré. Veuillez vous reconnecter.', 401);
      throw new AppError('Token invalide.', 401);
    }

    // 3. Validation ObjectId (Anti-Injection NoSQL)
    if (!isValidObjectId(decoded.userId)) {
      logger.warn(`[AUTH SECURITY] ObjectId malformé détecté: ${decoded.userId} - IP: ${req.ip}`);
      throw new AppError('Token corrompu.', 401);
    }

    // 4. Récupération Utilisateur en Temps Réel (Data Scrubbing .lean() pour la performance)
    // MODIFICATION : Suppression du cache Redis. Indispensable pour que le déblocage 
    // des abonnements par les admins soit perçu instantanément par les chauffeurs.
    const user = await User.findById(decoded.userId).select('-password -__v').lean();
      
    if (!user) {
      throw new AppError('L\'utilisateur appartenant à ce token n\'existe plus.', 401);
    }

    // 5. Vérification Ban
    if (user.isBanned) {
      logger.warn(`[AUTH BAN] Tentative accès par utilisateur banni: ${user.email}`);
      throw new AppError(`Compte suspendu: ${user.banReason || 'Raison non spécifiée'}`, 403);
    }

    // 6. Synchronisation dynamique du rôle
    if (decoded.role && decoded.role !== user.role) {
      logger.info(`[AUTH SYNC] Rôle Token (${decoded.role}) différent de la DB (${user.role}) pour ${user.email}. Application du nouveau rôle en temps réel.`);
    }

    // 7. Attachement User Sécurisé
    req.user = user;
    next();

  } catch (error) {
    next(error);
  }
};

/**
 * Middleware de contrôle d'accès par rôle (RBAC)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      logger.warn(`[AUTH FORBIDDEN] ${req.user.email} (${req.user.role}) a tenté d'accéder à une route ${roles.join('/')}`);
      return next(new AppError('Vous n\'avez pas la permission d\'effectuer cette action.', 403));
    }
    next();
  };
};

/**
 * Middleware authentification optionnelle
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return next();

    const decoded = verifyAccessToken(token);
    
    // MODIFICATION : Lecture directe DB pour garantir la fraîcheur des données
    const user = await User.findById(decoded.userId).select('name email role isBanned').lean();

    if (user && !user.isBanned) {
      req.user = user;
    }
    next();
  } catch (error) {
    next(); // On continue en tant qu'invité
  }
};

module.exports = { 
  protect, 
  authorize, 
  optionalAuth,
  isValidObjectId 
};