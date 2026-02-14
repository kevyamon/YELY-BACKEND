// src/controllers/authController.js
// ORCHESTRATION AUTH - Gestion Transactions & Réponses Standardisées
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const authService = require('../services/authService');
const { 
  generateAuthResponse, 
  rotateTokens, 
  clearRefreshTokenCookie, 
  verifyRefreshToken,
  revokeRefreshToken 
} = require('../utils/tokenService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const User = require('../models/User');

/**
 * @desc Inscription sécurisée avec transaction ACID
 * @route POST /api/auth/register
 */
const registerUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { name, email, phone, password, role } = req.body;

    const normalizedData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.replace(/\s/g, ''),
      password,
      role
    };

    const user = await authService.createUserInTransaction(normalizedData, session);
    const authTokens = generateAuthResponse(res, user);

    await session.commitTransaction();

    return successResponse(res, {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      ...authTokens
    }, 'Compte créé avec succès.', 201);

  } catch (error) {
    await session.abortTransaction();
    return errorResponse(res, error.message, error.status || 500, error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc Connexion sécurisée
 * @route POST /api/auth/login
 */
const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    
    const isEmail = identifier.includes('@');
    const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

    const user = await authService.verifyCredentials(normalizedId, password);
    const authTokens = generateAuthResponse(res, user);

    return successResponse(res, {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isAvailable: user.isAvailable
      },
      ...authTokens
    }, 'Connexion réussie.');

  } catch (error) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return errorResponse(res, error.message, error.status || 500, error);
  }
};

/**
 * @desc Rotation des tokens (Refresh)
 */
const refreshToken = async (req, res) => {
  try {
    const oldRefreshToken = req.cookies.refreshToken;
    if (!oldRefreshToken) throw { status: 401, message: 'Session expirée' };

    let decoded;
    try {
      // ⚠️ ASYNC : Vérifie DB + Crypto
      decoded = await verifyRefreshToken(oldRefreshToken);
    } catch (err) {
      clearRefreshTokenCookie(res);
      throw { status: 403, message: 'Token invalide ou révoqué' };
    }

    const user = await User.findById(decoded.userId);
    if (!user || user.isBanned) {
      clearRefreshTokenCookie(res);
      throw { status: 403, message: 'Utilisateur invalide ou banni' };
    }

    // ⚠️ ASYNC : Révoque l'ancien et crée le nouveau
    const tokens = await rotateTokens(res, oldRefreshToken, user._id, user.role);

    return successResponse(res, {
      accessToken: tokens.accessToken,
      expiresIn: 900
    }, 'Session rafraîchie.');

  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

/**
 * @desc Déconnexion
 */
const logoutUser = async (req, res) => {
  const token = req.cookies.refreshToken;
  
  if (token) {
    // ⚠️ ASYNC : On bannit le token pour empêcher sa réutilisation
    await revokeRefreshToken(token);
  }
  
  clearRefreshTokenCookie(res);
  return successResponse(res, null, 'Déconnexion réussie.');
};

/**
 * @desc Update Disponibilité
 */
const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user._id, 
      { isAvailable }, 
      { new: true }
    ).select('isAvailable');

    return successResponse(res, { isAvailable: user.isAvailable }, 
      isAvailable ? 'Vous êtes en ligne.' : 'Vous êtes hors ligne.'
    );
  } catch (error) {
    return errorResponse(res, error.message);
  }
};

module.exports = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  updateAvailability
};