// src/middleware/authMiddleware.js
// AUTHENTIFICATION FORTERESSE - Validation ObjectId, RBAC, Anti-tampering & CACHE REDIS (Tolérant aux pannes)
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokenService');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

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

    // 4. Vérification dans le cache Redis (AVEC FALLBACK SECURISÉ)
    const cacheKey = `auth:user:${decoded.userId}`;
    let user = null;
    let cachedUser = null;

    // Tentative de lecture Redis sécurisée
    try {
      cachedUser = await redisClient.get(cacheKey);
    } catch (redisError) {
      logger.warn(`[REDIS FALLBACK] Impossible de lire le cache pour ${decoded.userId}, bascule vers MongoDB.`);
    }

    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      // Récupération Utilisateur (Data Scrubbing .lean())
      user = await User.findById(decoded.userId).select('-password -__v').lean();
      
      if (!user) {
        throw new AppError('L\'utilisateur appartenant à ce token n\'existe plus.', 401);
      }
      
      // Tentative d'écriture Redis sécurisée
      try {
        await redisClient.setex(cacheKey, 900, JSON.stringify(user));
      } catch (redisError) {
        // On ne fait rien, ce n'est pas grave si on ne peut pas mettre en cache
      }
    }

    // 5. Vérification Ban
    if (user.isBanned) {
      logger.warn(`[AUTH BAN] Tentative accès par utilisateur banni: ${user.email}`);
      throw new AppError(`Compte suspendu: ${user.banReason || 'Raison non spécifiée'}`, 403);
    }

    // 6. Synchronisation dynamique du rôle (Évite la déconnexion forcée)
    if (decoded.role && decoded.role !== user.role) {
      logger.info(`[AUTH SYNC] Rôle Token (${decoded.role}) différent de la DB (${user.role}) pour ${user.email}. Application du nouveau rôle en temps réel.`);
      
      // Tentative de purge Redis sécurisée
      try {
        await redisClient.del(cacheKey); 
      } catch (redisError) {
        // Silencieux
      }
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
 * Middleware authentification optionnelle (Avec Fallback Sécurisé)
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return next();

    const decoded = verifyAccessToken(token);
    const cacheKey = `auth:user:${decoded.userId}`;
    
    let user = null;
    let cachedUser = null;

    try {
      cachedUser = await redisClient.get(cacheKey);
    } catch (redisError) {
      // Silencieux
    }
    
    if (cachedUser) {
      user = JSON.parse(cachedUser);
    } else {
      user = await User.findById(decoded.userId).select('name email role isBanned').lean();
      if (user) {
        try {
          await redisClient.setex(cacheKey, 900, JSON.stringify(user));
        } catch (redisError) {}
      }
    }

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