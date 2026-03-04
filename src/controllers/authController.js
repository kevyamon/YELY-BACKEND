// src/controllers/authController.js
// CONTROLEUR AUTHENTIFICATION - Alignement Parfait & Anti-Crash
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const authService = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const { generateAccessToken, generateRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie } = require('../utils/tokenService'); 

const registerUser = async (req, res) => {
  try {
    const user = await authService.register(req.body);

    const accessToken = generateAccessToken(user._id.toString(), user.role);
    const refreshTokenStr = generateRefreshToken(user._id.toString());

    setRefreshTokenCookie(res, refreshTokenStr);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
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

    const accessToken = generateAccessToken(user._id.toString(), user.role);
    const refreshTokenStr = generateRefreshToken(user._id.toString());

    setRefreshTokenCookie(res, refreshTokenStr);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
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

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    return successResponse(res, null, "Si cette adresse email est associee a un compte, un code de reinitialisation y a ete envoye.", 200);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return errorResponse(res, error.message || "Erreur lors de la demande de reinitialisation.", statusCode);
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    await authService.resetPasswordWithOtp(email, otp, newPassword);
    return successResponse(res, null, "Votre mot de passe a ete reinitialise avec succes. Vous pouvez maintenant vous connecter.", 200);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return errorResponse(res, error.message || "Erreur lors de la reinitialisation du mot de passe.", statusCode);
  }
};

const refreshToken = async (req, res) => {
  try {
    console.info('[AUTH_CONTROLLER] Requete de rafraichissement recue.');
    let token = req.body.refreshToken;
    
    if (!token && req.cookies && req.cookies.refreshToken) {
      console.info('[AUTH_CONTROLLER] Token absent du body, recuperation depuis les cookies.');
      token = req.cookies.refreshToken;
    }

    if (!token) {
       console.warn('[AUTH_CONTROLLER_FATAL] Aucun refresh token fourni par le client (ni body, ni cookie).');
       return errorResponse(res, "Refresh token manquant", 401);
    }
    
    console.info('[AUTH_CONTROLLER] Validation de la session en cours...');
    const user = await authService.validateSessionForRefresh(token);

    const newAccessToken = generateAccessToken(user._id.toString(), user.role);
    const newRefreshToken = generateRefreshToken(user._id.toString());

    setRefreshTokenCookie(res, newRefreshToken);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating,
      totalRides: user.totalRides,
      totalEarnings: user.totalEarnings,
      subscription: user.subscription 
    };

    console.info(`[AUTH_CONTROLLER_SUCCESS] Token rafraichi avec succes pour l'utilisateur: ${user._id}`);

    return successResponse(res, { 
      user: userData,
      accessToken: newAccessToken, 
      refreshToken: newRefreshToken 
    }, "Token rafraichi silencieusement", 200);

  } catch (error) {
    console.error('[AUTH_CONTROLLER_FATAL] Echec critique du Refresh Token. Raison:', error.message);
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