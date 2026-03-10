// src/controllers/authController.js
// CONTROLEUR AUTHENTIFICATION - Alignement Parfait & Anti-Crash (Bouclier Anti-Zombie Actif)
// STANDARD: Industriel / Bank Grade

const User = require('../models/User');
const authService = require('../services/authService');
const { successResponse } = require('../utils/responseHandler');
const { generateAccessToken, generateRefreshToken, setRefreshTokenCookie, clearRefreshTokenCookie } = require('../utils/tokenService'); 
const AppError = require('../utils/AppError'); 

const registerUser = async (req, res, next) => {
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
      subscription: user.subscription,
      vehicle: user.vehicle
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Compte cree avec succes', 201);

  } catch (error) {
    return next(error);
  }
};

const loginUser = async (req, res, next) => {
  try {
    const { identifier, password, clientPlatform } = req.body;

    if (!identifier || !password) {
      throw new AppError("Veuillez fournir un identifiant et un mot de passe.", 400);
    }

    const user = await authService.login(identifier, password, clientPlatform);

    // BOUCLIER ANTI-ZOMBIE 
    if (user.isDeleted) {
      throw new AppError("Ce compte a ete desactive ou supprime.", 403);
    }
    if (user.isBanned) {
      throw new AppError(`Ce compte est banni. Motif: ${user.banReason}`, 403);
    }

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
      subscription: user.subscription,
      vehicle: user.vehicle 
    };

    return successResponse(res, { 
      user: userData, 
      accessToken, 
      refreshToken: refreshTokenStr 
    }, 'Connexion reussie', 200);

  } catch (error) {
    return next(error);
  }
};

const logoutUser = async (req, res, next) => {
  try {
    clearRefreshTokenCookie(res);
    return successResponse(res, null, 'Deconnexion reussie', 200);
  } catch (error) {
    return next(error);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    await authService.forgotPassword(email);
    return successResponse(res, null, "Si cette adresse e-mail est associee a un compte, un code de reinitialisation y a ete envoye.", 200);
  } catch (error) {
    return next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    await authService.resetPasswordWithOtp(email, otp, newPassword);
    return successResponse(res, null, "Votre mot de passe a ete reinitialise avec succes. Vous pouvez maintenant vous connecter.", 200);
  } catch (error) {
    return next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    let token = req.body.refreshToken;
    const clientPlatform = req.body.clientPlatform;
    
    if (!token && req.cookies && req.cookies.refreshToken) {
      token = req.cookies.refreshToken;
    }

    if (!token) {
       throw new AppError("Session invalide ou expiree.", 401);
    }
    
    const user = await authService.validateSessionForRefresh(token, clientPlatform);

    if (user.isDeleted || user.isBanned) {
      throw new AppError("Session invalide, compte inactif.", 403);
    }

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
      subscription: user.subscription,
      vehicle: user.vehicle 
    };

    return successResponse(res, { 
      user: userData,
      accessToken: newAccessToken, 
      refreshToken: newRefreshToken 
    }, "Session rafraichie", 200);

  } catch (error) {
    clearRefreshTokenCookie(res); 
    return next(error);
  }
};

const updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    const user = await authService.updateAvailability(req.user._id, isAvailable);
    return successResponse(res, { isAvailable: user.isAvailable }, "Disponibilite mise a jour", 200);
  } catch (error) {
    return next(error);
  }
};

const updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    return successResponse(res, null, "Token systeme mis a jour", 200);
  } catch (error) {
    return next(error);
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