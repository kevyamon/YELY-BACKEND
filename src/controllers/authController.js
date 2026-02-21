// src/controllers/authController.js
// CONTRÔLEUR AUTHENTIFICATION - Alignement Parfait & Anti-Crash
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responseHandler');
// 🚀 CORRECTION : On utilise TES vraies fonctions de tokens !
const { generateTokens, verifyRefreshToken } = require('../utils/tokenService'); 
const { env } = require('../config/env');

const registerUser = async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // 1. LE RADAR ANTI-CRASH
    const userExists = await User.findOne({ 
      $or: [{ email: email }, { phone: phone }] 
    });
    
    if (userExists) {
      return errorResponse(res, "Ce numéro de téléphone ou cet email est déjà utilisé.", 400);
    }

    // 2. Création de l'utilisateur
    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: role || 'rider'
    });

    // 3. 🚀 CORRECTION : Génération correcte avec ton service !
    // generateTokens s'attend à recevoir un objet user complet pour inclure le rôle
    const tokens = generateTokens(user); 

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating
    };

    return successResponse(res, { 
      user: userData, 
      accessToken: tokens.accessToken, 
      refreshToken: tokens.refreshToken 
    }, 'Compte créé avec succès', 201);

  } catch (error) {
    console.error("[REGISTER CRASH PROTECTED]:", error);
    
    if (error.code === 11000) {
       return errorResponse(res, "Doublon détecté. Ce compte existe déjà.", 400);
    }

    return errorResponse(res, "Erreur interne lors de l'inscription.", 500);
  }
};

const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return errorResponse(res, "Veuillez fournir un identifiant et un mot de passe.", 400);
    }

    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: identifier }]
    }).select('+password'); 

    if (!user || !(await user.comparePassword(password, user.password))) {
      return errorResponse(res, "Identifiant ou mot de passe incorrect.", 401);
    }

    // 🚀 CORRECTION : Utilisation de ton service
    const tokens = generateTokens(user);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating
    };

    return successResponse(res, { 
      user: userData, 
      accessToken: tokens.accessToken, 
      refreshToken: tokens.refreshToken 
    }, 'Connexion réussie', 200);

  } catch (error) {
    console.error("[LOGIN ERROR]:", error);
    return errorResponse(res, "Erreur interne lors de la connexion.", 500);
  }
};

const logoutUser = async (req, res) => {
  try {
    return successResponse(res, null, 'Déconnexion réussie', 200);
  } catch (error) {
    return errorResponse(res, "Erreur lors de la déconnexion.", 500);
  }
};

const refreshToken = async (req, res) => {
  try {
    const token = req.body.refreshToken;
    if (!token) return errorResponse(res, "Refresh token manquant", 401);
    
    // 🚀 CORRECTION : On utilise ta fonction de vérification
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.userId);
    if (!user) return errorResponse(res, "Utilisateur invalide", 401);

    const tokens = generateTokens(user);

    return successResponse(res, { 
      accessToken: tokens.accessToken, 
      refreshToken: tokens.refreshToken 
    }, "Token rafraîchi", 200);
  } catch (error) {
    return errorResponse(res, "Token invalide ou expiré", 401);
  }
};

const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { isAvailable }, { new: true });
    return successResponse(res, { isAvailable: user.isAvailable }, "Disponibilité mise à jour", 200);
  } catch (error) {
    return errorResponse(res, "Erreur de mise à jour", 500);
  }
};

const updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    return successResponse(res, null, "Token FCM mis à jour", 200);
  } catch (error) {
    return errorResponse(res, "Erreur de mise à jour", 500);
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