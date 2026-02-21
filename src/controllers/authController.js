// src/controllers/authController.js
// CONTRÔLEUR AUTHENTIFICATION - Restauration Complète & Inscription Blindée
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

// Fonction interne pour fabriquer les badges d'accès (Tokens)
const signToken = (id) => {
  return jwt.sign({ userId: id }, env.JWT_SECRET || process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

const register = async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // 1. LE RADAR ANTI-CRASH : On vérifie les doublons AVANT de créer
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

    // 3. Génération des clés d'accès
    const accessToken = signToken(user._id);
    const refreshToken = signToken(user._id); 

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating
    };

    return successResponse(res, { user: userData, accessToken, refreshToken }, 'Compte créé avec succès', 201);

  } catch (error) {
    console.error("[REGISTER CRASH PROTECTED]:", error);
    
    if (error.code === 11000) {
       return errorResponse(res, "Doublon détecté. Ce compte existe déjà.", 400);
    }

    return errorResponse(res, "Erreur interne lors de l'inscription.", 500);
  }
};

const login = async (req, res) => {
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

    const accessToken = signToken(user._id);
    const refreshToken = signToken(user._id);

    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isAvailable: user.isAvailable,
      rating: user.rating
    };

    return successResponse(res, { user: userData, accessToken, refreshToken }, 'Connexion réussie', 200);

  } catch (error) {
    console.error("[LOGIN ERROR]:", error);
    return errorResponse(res, "Erreur interne lors de la connexion.", 500);
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return errorResponse(res, "Utilisateur non trouvé.", 404);
    }
    return successResponse(res, { user }, 'Profil récupéré', 200);
  } catch (error) {
    return errorResponse(res, "Erreur lors de la récupération du profil.", 500);
  }
};

// 🚀 LA FONCTION QUI MANQUAIT ET QUI FAISAIT PLANTER LE SERVEUR
const logout = async (req, res) => {
  try {
    // Si tu gères les tokens côté client, le backend a juste besoin de valider la requête
    return successResponse(res, null, 'Déconnexion réussie', 200);
  } catch (error) {
    return errorResponse(res, "Erreur lors de la déconnexion.", 500);
  }
};

// 🚀 NOUVEAU : On s'assure que TOUT est exporté correctement pour authRoutes.js
module.exports = {
  register,
  login,
  getMe,
  logout
};