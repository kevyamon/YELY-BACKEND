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
      totalEarnings: user.totalEarnings,
      subscription: user.subscription 
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Compte cree avec succes', 201);

  } catch (error) {
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
      totalEarnings: user.totalEarnings,
      subscription: user.subscription 
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Connexion reussie', 200);

  } catch (error) {
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

// ==========================================
// NOUVEAUX CONTROLEURS - MOT DE PASSE OUBLIÉ
// ==========================================

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    
    // SECURITE: Message générique pour éviter l'énumération d'emails par les hackers
    return successResponse(res, null, "Si cette adresse email est associée à un compte, un code de réinitialisation y a été envoyé.", 200);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur lors de la demande de réinitialisation.", statusCode);
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    await authService.resetPasswordWithOtp(email, otp, newPassword);
    
    return successResponse(res, null, "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.", 200);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return errorResponse(res, error.message || "Erreur lors de la réinitialisation du mot de passe.", statusCode);
  }
};

// ==========================================

const refreshToken = async (req, res) => {
  try {
    let token = req.body.refreshToken;
    if (!token && req.cookies && req.cookies.refreshToken) {
      token = req.cookies.refreshToken;
    }

    if (!token) {
       return errorResponse(res, "Refresh token manquant", 401);
    }
    
    const user = await authService.validateSessionForRefresh(token);

    const newAccessToken = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

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
      totalEarnings: user.totalEarnings,
      subscription: user.subscription 
    };

    return successResponse(res, { 
      user: userData,
      accessToken: newAccessToken, 
      refreshToken: newRefreshToken 
    }, "Token rafraichi silencieusement", 200);

  } catch (error) {
    clearRefreshTokenCookie(res); 
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
  forgotPassword,
  resetPassword,
  refreshToken,
  updateAvailability,
  updateFcmToken
};