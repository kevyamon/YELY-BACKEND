// src/utils/tokenService.js
// GESTION TOKENS JWT - Access 15min / Refresh 7j + Rotation + Révocation
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const { env, isProd } = require('../config/env');

// Stockage temporaire tokens révoqués (TODO: Redis en production)
const revokedTokens = new Set();

// Configuration tokens
const TOKEN_CONFIG = {
  access: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRATION, // '15m'
    options: { algorithm: 'HS256' }
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRATION, // '7d'
    options: { algorithm: 'HS256' }
  }
};

/**
 * Génère un access token (court terme)
 * @param {string} userId - ID utilisateur
 * @param {string} role - Rôle utilisateur
 * @returns {string} JWT signé
 */
const generateAccessToken = (userId, role) => {
  return jwt.sign(
    { 
      userId, 
      role, 
      type: 'access',
      iat: Math.floor(Date.now() / 1000)
    },
    TOKEN_CONFIG.access.secret,
    { expiresIn: TOKEN_CONFIG.access.expiresIn }
  );
};

/**
 * Génère un refresh token (long terme, stocké httpOnly)
 * @param {string} userId - ID utilisateur
 * @returns {string} JWT signé
 */
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { 
      userId, 
      type: 'refresh',
      jti: require('crypto').randomUUID(), // ID unique pour révocation ciblée
      iat: Math.floor(Date.now() / 1000)
    },
    TOKEN_CONFIG.refresh.secret,
    { expiresIn: TOKEN_CONFIG.refresh.expiresIn }
  );
};

/**
 * Configure le cookie httpOnly pour refresh token
 * @param {Object} res - Response Express
 * @param {string} refreshToken - Token à stocker
 */
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,        // Pas accessible au JS
    secure: isProd,        // HTTPS uniquement en prod
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    path: '/api/auth/refresh', // Cookie uniquement pour ce endpoint
    signed: false,         // On signe pas le cookie, le token à l'intérieur est déjà signé
  });
};

/**
 * Supprime le cookie de refresh token (logout)
 * @param {Object} res - Response Express
 */
const clearRefreshTokenCookie = (res) => {
  res.cookie('refreshToken', '', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    expires: new Date(0),
    path: '/api/auth/refresh',
  });
};

/**
 * Vérifie un access token
 * @param {string} token - Token à vérifier
 * @returns {Object} Payload décodé
 * @throws {Error} Si token invalide ou expiré
 */
const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, TOKEN_CONFIG.access.secret);
  if (decoded.type !== 'access') {
    throw new Error('Token type mismatch');
  }
  return decoded;
};

/**
 * Vérifie un refresh token (vérifie aussi révocation)
 * @param {string} token - Token à vérifier
 * @returns {Object} Payload décodé
 * @throws {Error} Si token invalide, expiré ou révoqué
 */
const verifyRefreshToken = (token) => {
  if (revokedTokens.has(token)) {
    throw new Error('Token revoked');
  }
  const decoded = jwt.verify(token, TOKEN_CONFIG.refresh.secret);
  if (decoded.type !== 'refresh') {
    throw new Error('Token type mismatch');
  }
  return decoded;
};

/**
 * Révoque un refresh token (logout, suspicion compromission)
 * @param {string} token - Token à révoquer
 */
const revokeRefreshToken = (token) => {
  revokedTokens.add(token);
  // TODO: Persist in Redis with TTL matching token expiry
  console.log(`[TOKEN] Révocation token: ${token.slice(-10)}...`);
};

/**
 * Rotation des tokens: génère nouvelle paire, révoque ancien refresh
 * @param {Object} res - Response Express
 * @param {string} oldRefreshToken - Ancien token à révoquer
 * @param {string} userId - ID utilisateur
 * @param {string} role - Rôle utilisateur
 * @returns {Object} { accessToken, refreshToken }
 */
const rotateTokens = (res, oldRefreshToken, userId, role) => {
  // Révoquer l'ancien
  revokeRefreshToken(oldRefreshToken);
  
  // Générer nouvelle paire
  const accessToken = generateAccessToken(userId, role);
  const refreshToken = generateRefreshToken(userId);
  
  // Définir nouveau cookie
  setRefreshTokenCookie(res, refreshToken);
  
  return { accessToken, refreshToken };
};

/**
 * Génère la réponse complète de login/register
 * @param {Object} res - Response Express
 * @param {Object} user - Document utilisateur (sans password)
 * @returns {Object} Réponse formatée
 */
const generateAuthResponse = (res, user) => {
  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  
  setRefreshTokenCookie(res, refreshToken);
  
  return {
    success: true,
    data: {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        subscription: user.subscription,
        isAvailable: user.isAvailable,
      },
      accessToken,
      expiresIn: 900, // 15 minutes en secondes
    }
  };
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  rotateTokens,
  generateAuthResponse,
  revokedTokens, // Export pour tests/debug
};