// src/controllers/authController.js
// CONTROLEUR AUTHENTIFICATION - Alignement Parfait & Anti-Crash
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const authService = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { generateAccessToken, generateRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie } = require('../utils/tokenService'); 
const { env } = require('../config/env');

const registerUser = async (req, res) => {
  try {
    const user = await authService.register(req.body);

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshTokenStr = generateRefreshToken(user._id);

    // On set le cookie pour les clients Web
    setRefreshTokenCookie(res, refreshTokenStr);

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
      refreshToken: refreshTokenStr // Indispensable pour l'App Mobile
    }, 'Compte cree avec succes', 201);

  } catch (error) {
    console.error("[REGISTER ERROR]:", error.message || error);
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

    const user = await authService.login(identifier, password);

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshTokenStr = generateRefreshToken(user._id);

    // On set le cookie pour les clients Web
    setRefreshTokenCookie(res, refreshTokenStr);

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
      refreshToken: refreshTokenStr // Indispensable pour l'App Mobile
    }, 'Connexion reussie', 200);

  } catch (error) {
    console.error("[LOGIN ERROR]:", error.message || error);
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur interne lors de la connexion.", statusCode);
  }
};

const logoutUser = async (req, res) => {
  try {
    clearRefreshTokenCookie(res);
    return successResponse(res, null, 'Deconnexion reussie', 200);
  } catch (error) {
    return errorResponse(res, "Erreur lors de la deconnexion.", 500);
  }
};

const refreshToken = async (req, res) => {
  try {
    // 1. Cherche le token dans le Body (Mobile) OU dans les Cookies (Web)
    let token = req.body.refreshToken;
    if (!token && req.cookies && req.cookies.refreshToken) {
      token = req.cookies.refreshToken;
    }

    if (!token) {
       return errorResponse(res, "Refresh token manquant", 401);
    }
    
    // 2. Valide la session
    const user = await authService.validateSessionForRefresh(token);

    // 3. Génère les nouveaux tokens
    const newAccessToken = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    // 4. Met à jour le cookie (Web)
    setRefreshTokenCookie(res, newRefreshToken);

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
      accessToken: newAccessToken, 
      refreshToken: newRefreshToken // Le mobile DOIT recevoir ceci pour la prochaine rotation
    }, "Token rafraichi silencieusement", 200);

  } catch (error) {
    console.error("[REFRESH CRITICAL FAILURE]:", error.message || error);
    clearRefreshTokenCookie(res); // Purge de sécurité
    const statusCode = error.statusCode || 401;
    return errorResponse(res, error.message || "Session definitivement invalide", statusCode);
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