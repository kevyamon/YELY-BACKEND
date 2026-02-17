// src/controllers/authController.js
const authService = require('../services/authService');
const { 
  generateAuthResponse, 
  rotateTokens, 
  clearRefreshTokenCookie, 
  revokeRefreshToken 
} = require('../utils/tokenService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const registerUser = async (req, res) => {
  try {
    const user = await authService.register(req.body);
    const authTokens = generateAuthResponse(res, user);

    return successResponse(res, {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        subscription: user.subscription 
      },
      ...authTokens
    }, 'Compte créé avec succès.', 201);
  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const user = await authService.login(identifier, password);
    const authTokens = generateAuthResponse(res, user);

    return successResponse(res, {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isAvailable: user.isAvailable,
        subscription: user.subscription 
      },
      ...authTokens
    }, 'Connexion réussie.');
  } catch (error) {
    return errorResponse(res, error.message, error.status || 401);
  }
};

const refreshToken = async (req, res) => {
  try {
    const oldRefreshToken = req.cookies.refreshToken;
    if (!oldRefreshToken) {
      return errorResponse(res, 'Session expirée', 401);
    }

    const user = await authService.validateSessionForRefresh(oldRefreshToken);
    const tokens = await rotateTokens(res, oldRefreshToken, user._id, user.role);

    return successResponse(res, {
      accessToken: tokens.accessToken,
      expiresIn: 900
    }, 'Session rafraîchie.');
  } catch (error) {
    clearRefreshTokenCookie(res);
    return errorResponse(res, error.message, error.status || 403);
  }
};

const logoutUser = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (token) await revokeRefreshToken(token);
  
  clearRefreshTokenCookie(res);
  return successResponse(res, null, 'Déconnexion réussie.');
};

const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    const result = await authService.updateAvailability(req.user._id, isAvailable);

    return successResponse(res, result, 
      isAvailable ? 'Vous êtes en ligne.' : 'Vous êtes hors ligne.'
    );
  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await require('../models/User').findByIdAndUpdate(req.user._id, { fcmToken });
    return successResponse(res, null, 'Token de notification mis à jour.');
  } catch (error) {
    return errorResponse(res, error.message, error.status || 500);
  }
};

module.exports = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  updateAvailability,
  updateFcmToken
};