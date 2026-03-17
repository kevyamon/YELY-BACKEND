// src/utils/tokenService.js
// GESTION TOKENS JWT - Access 15min / Refresh 30j + Blacklist Hachee (SHA-256)
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { env } = require('../config/env');
const TokenBlacklist = require('../models/TokenBlacklist'); 

const isProd = env.NODE_ENV === 'production';

const TOKEN_CONFIG = {
  access: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRATION || '15m'
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET || env.JWT_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRATION || '30d'
  }
};

const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const cleanTokenString = (token) => {
  if (!token) return null;
  return token.replace(/^"|"$/g, '').trim();
};

const generateAccessToken = (userId, role) => {
  return jwt.sign(
    { 
      userId: userId.toString(),
      role, 
      type: 'access'
    },
    TOKEN_CONFIG.access.secret,
    { expiresIn: TOKEN_CONFIG.access.expiresIn }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    { 
      userId: userId.toString(),
      type: 'refresh',
      jti: crypto.randomBytes(16).toString('hex') 
    },
    TOKEN_CONFIG.refresh.secret,
    { expiresIn: TOKEN_CONFIG.refresh.expiresIn }
  );
};

const setRefreshTokenCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, 
    path: '/api/v1/auth',
    signed: false,
  });
};

const clearRefreshTokenCookie = (res) => {
  res.cookie('refreshToken', '', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    expires: new Date(0),
    path: '/api/v1/auth', 
  });
};

const verifyAccessToken = (token) => {
  const cleanToken = cleanTokenString(token);
  // SECURITE : Forcer l'algorithme pour eviter l'Algorithm Switching
  const decoded = jwt.verify(cleanToken, TOKEN_CONFIG.access.secret, { algorithms: ['HS256'] });
  if (decoded.type !== 'access') throw new Error('Token type mismatch');
  return decoded;
};

const verifyRefreshToken = async (token) => {
  try {
    const cleanToken = cleanTokenString(token);
    const hashedToken = hashToken(cleanToken);
    
    const isBlacklisted = await TokenBlacklist.exists({ token: hashedToken });
    if (isBlacklisted) throw new Error('Token revoque (Blacklist)');

    // SECURITE : Forcer l'algorithme
    const decoded = jwt.verify(cleanToken, TOKEN_CONFIG.refresh.secret, { algorithms: ['HS256'] });
    if (decoded.type !== 'refresh') throw new Error('Token type mismatch');
    
    return decoded;
  } catch (error) {
    console.error(`[JWT] Erreur de vérification Refresh: ${error.message}`);
    throw error;
  }
};

const revokeRefreshToken = async (token) => {
  try {
    const cleanToken = cleanTokenString(token);
    const hashedToken = hashToken(cleanToken);
    await TokenBlacklist.create({ token: hashedToken });
  } catch (err) {
    if (err.code !== 11000) console.error('[TOKEN] Erreur revocation:', err.message);
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  verifyAccessToken,
  verifyRefreshToken,
  revokeRefreshToken,
  hashToken,
  cleanTokenString
};