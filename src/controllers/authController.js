// src/controllers/authController.js
// CONTROLEUR AUTHENTIFICATION - Alignement Parfait & Anti-Crash
// CSCSM Level: Bank Grade

const User = require('../models/User');
const authService = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { generateAccessToken, generateRefreshToken } = require('../utils/tokenService'); 
const { env } = require('../config/env');

const registerUser = async (req, res) => {
  try {
    // Delegation absolue au service : bloque l'usurpation du role admin
    const user = await authService.register(req.body);

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshTokenStr = generateRefreshToken(user._id);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating,
      totalRides: user.totalRides,
      totalEarnings: user.totalEarnings
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Compte cree avec succes', 201);

  } catch (error) {
    console.error("[REGISTER CRASH PROTECTED]:", error);
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur interne lors de l'inscription.", statusCode);
  }
};

const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return errorResponse(res, "Veuillez fournir un identifiant et un mot de passe.", 400);
    }

    // Delegation absolue au service : active l'anti-bruteforce et l'anti-timing
    const user = await authService.login(identifier, password);

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshTokenStr = generateRefreshToken(user._id);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating,
      totalRides: user.totalRides,
      totalEarnings: user.totalEarnings
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Connexion reussie', 200);

  } catch (error) {
    console.error("[LOGIN ERROR]:", error);
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur interne lors de la connexion.", statusCode);
  }
};

const logoutUser = async (req, res) => {
  try {
    return successResponse(res, null, 'Deconnexion reussie', 200);
  } catch (error) {
    return errorResponse(res, "Erreur lors de la deconnexion.", 500);
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.body.refreshToken;
    if (!token) return errorResponse(res, "Refresh token manquant", 401);
    
    // Utilisation du service pour s'assurer que l'utilisateur n'a pas ete banni entre temps
    const user = await authService.validateSessionForRefresh(token);

    const newAccessToken = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    return successResponse(res, { 
      accessToken: newAccessToken, 
      refreshToken: newRefreshToken 
    }, "Token rafraichi", 200);
  } catch (error) {
    return errorResponse(res, "Token invalide ou expire", 401);
  }
};

const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    const user = await authService.updateAvailability(req.user._id, isAvailable);
    return successResponse(res, { isAvailable: user.isAvailable }, "Disponibilite mise a jour", 200);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur de mise a jour", statusCode);
  }
};

const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    return successResponse(res, null, "Token FCM mis a jour", 200);
  } catch (error) {
    return errorResponse(res, "Erreur de mise a jour", 500);
  }
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  refreshToken,
  updateAvailability,
  updateFcmToken
};