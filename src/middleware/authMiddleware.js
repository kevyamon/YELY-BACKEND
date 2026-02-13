// src/middleware/authMiddleware.js
// AUTHENTIFICATION FORTERESSE - Validation ObjectId, cohérence rôles, anti-tampering
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { verifyAccessToken } = require('../utils/tokenService');

/**
 * Valide qu'une chaîne est un ObjectId MongoDB valide
 * Protection contre injection NoSQL via IDs
 * @param {string} id - ID à valider
 * @returns {boolean}
 */
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id) && 
         new mongoose.Types.ObjectId(id).toString() === id;
};

/**
 * Middleware d'authentification principal
 * Vérifie Bearer token, valide ObjectId, vérifie cohérence rôle
 */
const protect = async (req, res, next) => {
  try {
    let token;

    // Extraction Bearer token uniquement
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise. Token manquant.',
        code: 'TOKEN_MISSING'
      });
    }

    // Vérification JWT
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expirée. Veuillez vous reconnecter.',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Token invalide.',
        code: 'TOKEN_INVALID'
      });
    }

    // Validation ObjectId (anti-injection)
    if (!isValidObjectId(decoded.userId)) {
      console.warn(`[AUTH] ObjectId invalide détecté: ${decoded.userId}`);
      return res.status(401).json({
        success: false,
        message: 'Token corrompu.',
        code: 'TOKEN_CORRUPTED'
      });
    }

    // Récupération utilisateur (lean pour perf)
    const user = await User.findById(decoded.userId)
      .select('-password -__v')
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable ou désactivé.',
        code: 'USER_NOT_FOUND'
      });
    }

    // Vérification ban
    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: 'Compte suspendu.',
        reason: user.banReason || 'Violation des conditions d\'utilisation',
        code: 'USER_BANNED'
      });
    }

    // Vérification anti-tampering: rôle token vs DB
    if (decoded.role && decoded.role !== user.role) {
      console.warn(`[SECURITY] Rôle mismatch - Token: ${decoded.role}, DB: ${user.role}, User: ${user.email}`);
      return res.status(403).json({
        success: false,
        message: 'Session invalide. Veuillez vous reconnecter.',
        code: 'ROLE_MISMATCH'
      });
    }

    // Attache données sécurisées à la requête
    req.user = {
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      subscription: user.subscription,
      currentLocation: user.currentLocation
    };

    // Log pour audit (en prod: logger structuré)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[AUTH] ${user.email} (${user.role}) - ${req.method} ${req.originalUrl}`);
    }

    next();
  } catch (error) {
    console.error('[AUTH MIDDLEWARE] Erreur:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur d\'authentification.',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware de contrôle d'accès par rôle
 * @param  {...string} allowedRoles - Rôles autorisés
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise.',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      // Log sécurité
      console.warn(`[SECURITY] Accès refusé: ${req.user.email} (${req.user.role}) tenté ${req.originalUrl}`);
      
      return res.status(403).json({
        success: false,
        message: 'Accès interdit. Privilèges insuffisants.',
        code: 'FORBIDDEN'
      });
    }

    next();
  };
};

/**
 * Middleware optionnel: authentifie si token présent, ne bloque pas si absent
 * Utile pour logout, endpoints publics avec données utilisateur si dispo
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    
    if (isValidObjectId(decoded.userId)) {
      const user = await User.findById(decoded.userId)
        .select('name email role isBanned')
        .lean();
      
      if (user && !user.isBanned) {
        req.user = {
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role
        };
      }
    }
    
    next();
  } catch (error) {
    // En mode optionnel, on ignore les erreurs d'auth
    next();
  }
};

module.exports = { 
  protect, 
  authorize, 
  optionalAuth, 
  isValidObjectId 
};