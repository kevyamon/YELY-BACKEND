// src/controllers/authController.js
// ORCHESTRATION AUTH - Gestion Transactions & Réponses Standardisées
// CSCSM Level: Bank Grade

const mongoose = require('mongoose');
const authService = require('../services/authService');
const { generateAuthResponse, rotateTokens, clearRefreshTokenCookie, verifyRefreshToken } = require('../utils/tokenService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const User = require('../models/User'); // Pour updates simples

/**
 * @desc Inscription sécurisée avec transaction ACID
 * @route POST /api/auth/register
 */
const registerUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { name, email, phone, password, role } = req.body;

    // 1. Normalisation (Contrôleur prépare les données)
    const normalizedData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.replace(/\s/g, ''),
      password,
      role
    };

    // 2. Appel du Service (Logique métier)
    const user = await authService.createUserInTransaction(normalizedData, session);

    // 3. Génération Tokens
    const authTokens = generateAuthResponse(res, user);

    // 4. Commit Transaction
    await session.commitTransaction();

    // 5. Réponse Standardisée (Fixe le bug Frontend)
    return successResponse(res, {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      ...authTokens // accessToken, refreshToken, expiresIn
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
    
    // Normalisation
    const isEmail = identifier.includes('@');
    const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

    // Appel Service
    const user = await authService.verifyCredentials(normalizedId, password);

    // Génération Tokens
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
    // Délai artificiel en cas d'erreur (Anti-Bruteforce basic)
    await new Promise(resolve => setTimeout(resolve, 500));
    return errorResponse(res, error.message, error.status || 500, error);
  }
};

/**
 * @desc Rotation des tokens
 */
const refreshToken = async (req, res) => {
  try {
    const oldRefreshToken = req.cookies.refreshToken;
    if (!oldRefreshToken) throw { status: 401, message: 'Session expirée' };

    let decoded;
    try {
      decoded = verifyRefreshToken(oldRefreshToken);
    } catch (err) {
      clearRefreshTokenCookie(res);
      throw { status: 403, message: 'Token invalide' };
    }

    const user = await User.findById(decoded.userId);
    if (!user || user.isBanned) {
      clearRefreshTokenCookie(res);
      throw { status: 403, message: 'Utilisateur invalide ou banni' };
    }

    const tokens = rotateTokens(res, oldRefreshToken, user._id, user.role);

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
    // Optionnel: Ajouter à une blacklist Redis
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
    
    // Logique rapide directement dans controller (ou déplacer en service si complexe)
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