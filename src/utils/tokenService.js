// src/utils/tokenService.js
// GESTION TOKENS JWT - Access 15min / Refresh 7j + Blacklist MongoDB
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const TokenBlacklist = require('../models/TokenBlacklist'); // Intégration DB

const isProd = env.NODE_ENV === 'production';

// Configuration tokens
const TOKEN_CONFIG = {
  access: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRATION || '15m',
    options: { algorithm: 'HS256' }
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET || env.JWT_SECRET,
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
    secure: isProd,
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

/**
 * Vérifie un refresh token (Signature + Blacklist DB)
 * ⚠️ ASYNC MAINTENANT
 */
const verifyRefreshToken = async (token) => {
  // 1. Vérification Blacklist DB
  const isBlacklisted = await TokenBlacklist.exists({ token });
  if (isBlacklisted) throw new Error('Token revoked');

  // 2. Vérification Signature Crypto
  const decoded = jwt.verify(token, TOKEN_CONFIG.refresh.secret);
  if (decoded.type !== 'refresh') throw new Error('Token type mismatch');
  
  return decoded;
};

/**
 * Révoque un token en l'ajoutant en base
 * ⚠️ ASYNC MAINTENANT
 */
const revokeRefreshToken = async (token) => {
  try {
    await TokenBlacklist.create({ token });
    console.log(`[TOKEN] Révocation persistante: ${token.slice(-10)}...`);
  } catch (err) {
    // Ignore erreur si déjà blacklisté (code 11000)
    if (err.code !== 11000) console.error('[TOKEN] Erreur révocation:', err.message);
  }
};

/**
 * Rotation sécurisée : Révoque l'ancien -> Crée le nouveau
 * ⚠️ ASYNC MAINTENANT
 */
const rotateTokens = async (res, oldRefreshToken, userId, role) => {
  await revokeRefreshToken(oldRefreshToken); // Invalide l'ancien immédiatement
  
  const accessToken = generateAccessToken(userId, role);
  const refreshToken = generateRefreshToken(userId);
  
  setRefreshTokenCookie(res, refreshToken);
  return { accessToken, refreshToken };
};

const generateAuthResponse = (res, user) => {
  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  
  setRefreshTokenCookie(res, refreshToken);
  
  return {
    accessToken,
    refreshToken,
    expiresIn: 900
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
};