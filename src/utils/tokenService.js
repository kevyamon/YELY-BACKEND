// src/utils/tokenService.js
// GESTION TOKENS JWT - Access 15min / Refresh 7j + Rotation + Révocation
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

// Stockage temporaire tokens révoqués (TODO: Redis en production)
const revokedTokens = new Set();

const isProd = env.NODE_ENV === 'production';

// Configuration tokens
const TOKEN_CONFIG = {
  access: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRATION || '15m',
    options: { algorithm: 'HS256' }
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET || env.JWT_SECRET, // Fallback si pas de secret dédié
    expiresIn: env.JWT_REFRESH_EXPIRATION || '7d',
    options: { algorithm: 'HS256' }
  }
};

/**
 * Génère un access token (court terme)
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
 * Génère un refresh token (long terme)
 */
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { 
      userId, 
      type: 'refresh',
      jti: require('crypto').randomUUID(),
      iat: Math.floor(Date.now() / 1000)
    },
    TOKEN_CONFIG.refresh.secret,
    { expiresIn: TOKEN_CONFIG.refresh.expiresIn }
  );
};

/**
 * Configure le cookie httpOnly pour refresh token
 */
const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd, // HTTPS en prod
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    path: '/api/auth/refresh',
    signed: false,
  });
};

/**
 * Supprime le cookie de refresh token
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

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, TOKEN_CONFIG.access.secret);
  if (decoded.type !== 'access') throw new Error('Token type mismatch');
  return decoded;
};

const verifyRefreshToken = (token) => {
  if (revokedTokens.has(token)) throw new Error('Token revoked');
  const decoded = jwt.verify(token, TOKEN_CONFIG.refresh.secret);
  if (decoded.type !== 'refresh') throw new Error('Token type mismatch');
  return decoded;
};

const revokeRefreshToken = (token) => {
  revokedTokens.add(token);
  console.log(`[TOKEN] Révocation token: ${token.slice(-10)}...`);
};

const rotateTokens = (res, oldRefreshToken, userId, role) => {
  revokeRefreshToken(oldRefreshToken);
  const accessToken = generateAccessToken(userId, role);
  const refreshToken = generateRefreshToken(userId);
  setRefreshTokenCookie(res, refreshToken);
  return { accessToken, refreshToken };
};

/**
 * 🛠️ CORRECTION MAJEURE ICI
 * Génère les tokens et le cookie, mais renvoie un objet PLAT.
 * Plus de "success: true" ou de "data" imbriqué.
 */
const generateAuthResponse = (res, user) => {
  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  
  // Side-effect: Pose le cookie
  setRefreshTokenCookie(res, refreshToken);
  
  // Retourne UNIQUEMENT les données brutes des tokens
  return {
    accessToken,
    refreshToken, // Optionnel si géré par cookie, mais utile pour debug/mobile
    expiresIn: 900 // 15 min en secondes
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
  revokedTokens,
};