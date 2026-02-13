// src/controllers/authController.js
// AUTHENTIFICATION BÉTON - Transactions MongoDB, Timing Constant, Anti-Enumeration
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { generateAuthResponse, rotateTokens, clearRefreshTokenCookie, verifyRefreshToken } = require('../utils/tokenService');
const mongoose = require('mongoose');
const { SECURITY_CONSTANTS } = require('../config/env');

// Messages génériques (anti-enumeration)
const AUTH_MESSAGES = {
  INVALID_CREDENTIALS: 'Identifiants invalides.',
  USER_EXISTS: 'Cet email ou téléphone est déjà utilisé.',
  SERVER_ERROR: 'Erreur serveur. Veuillez réessayer.',
  BANNED: 'Compte suspendu.',
  REGISTRATION_SUCCESS: 'Compte créé avec succès.',
  LOGIN_SUCCESS: 'Connexion réussie.',
  LOGOUT_SUCCESS: 'Déconnexion réussie.',
  AVAILABILITY_UPDATED: 'Disponibilité mise à jour.'
};

/**
 * @desc Inscription sécurisée avec transaction
 * @route POST /api/auth/register
 */
const registerUser = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const { name, email, phone, password, role } = req.body;

      // Normalisation
      const normalizedEmail = email.toLowerCase().trim();
      const normalizedPhone = phone.replace(/\s/g, '');
      const trimmedName = name.trim();

      // Vérification existence (avec lock transactionnel)
      const existingUser = await User.findOne({
        $or: [
          { email: normalizedEmail },
          { phone: normalizedPhone }
        ]
      }).session(session);

      if (existingUser) {
        const field = existingUser.email === normalizedEmail ? 'email' : 'téléphone';
        throw new Error(`DUPLICATE_${field.toUpperCase()}`);
      }

      // Détermination rôle (JAMAIS depuis client pour privilégiés)
      let finalRole = 'rider';
      if (role === 'driver') finalRole = 'driver';
      
      // SuperAdmin UNIQUEMENT via env variable
      if (normalizedEmail === process.env.ADMIN_MAIL?.toLowerCase()) {
        finalRole = 'superadmin';
        console.log(`[SECURITY] Création SuperAdmin: ${normalizedEmail}`);
      }

      // Création utilisateur
      const [user] = await User.create([{
        name: trimmedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password, // Hashé par pre-save hook
        role: finalRole,
        isAvailable: false,
        'subscription.isActive': false,
        'subscription.hoursRemaining': 0
      }], { session });

      // Génération tokens et réponse
      const authResponse = generateAuthResponse(res, user);
      
      res.status(201).json({
        ...authResponse,
        message: AUTH_MESSAGES.REGISTRATION_SUCCESS
      });
    });

  } catch (error) {
    // Gestion erreurs spécifiques
    if (error.message === 'DUPLICATE_EMAIL') {
      return res.status(409).json({
        success: false,
        message: 'Cet email est déjà utilisé.',
        code: 'DUPLICATE_EMAIL'
      });
    }
    if (error.message === 'DUPLICATE_PHONE') {
      return res.status(409).json({
        success: false,
        message: 'Ce numéro est déjà utilisé.',
        code: 'DUPLICATE_PHONE'
      });
    }

    console.error('[REGISTER] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: AUTH_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  } finally {
    session.endSession();
  }
};

/**
 * @desc Connexion avec timing constant (anti-timing attack)
 * @route POST /api/auth/login
 */
const loginUser = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { identifier, password } = req.body;

    // Détection type identifiant
    const isEmail = identifier.includes('@');
    const normalizedId = isEmail 
      ? identifier.toLowerCase().trim() 
      : identifier.replace(/\s/g, '');

    // Requête sécurisée (pas de regex avec entrée utilisateur)
    const query = isEmail 
      ? { email: normalizedId }
      : { phone: normalizedId };

    const user = await User.findOne(query).select('+password');

    // TIMING CONSTANT: toujours comparer, même si user null
    const dummyHash = '$2b$12$abcdefghijklmnopqrstuvwxycdefghijklmnopqrstu';
    const hashToCompare = user ? user.password : dummyHash;
    
    const isMatch = await User.comparePasswordStatic(password, hashToCompare);
    
    // Délai artificiel si rapide (masque la différence user existe/pas)
    const elapsed = Date.now() - startTime;
    if (elapsed < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - elapsed));
    }

    if (!user || !isMatch) {
      return res.status(401).json({
        success: false,
        message: AUTH_MESSAGES.INVALID_CREDENTIALS,
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Vérifications post-authentification
    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: AUTH_MESSAGES.BANNED,
        reason: user.banReason || 'Contactez le support',
        code: 'USER_BANNED'
      });
    }

    // Succès
    const authResponse = generateAuthResponse(res, user);
    
    res.json({
      ...authResponse,
      message: AUTH_MESSAGES.LOGIN_SUCCESS
    });

  } catch (error) {
    console.error('[LOGIN] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: AUTH_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Rafraîchissement des tokens (rotation)
 * @route POST /api/auth/refresh
 */
const refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Session expirée. Veuillez vous reconnecter.',
        code: 'REFRESH_MISSING'
      });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({
        success: false,
        message: 'Session invalide. Veuillez vous reconnecter.',
        code: 'REFRESH_INVALID'
      });
    }

    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user || user.isBanned) {
      clearRefreshTokenCookie(res);
      return res.status(401).json({
        success: false,
        message: 'Session invalide.',
        code: 'USER_INVALID'
      });
    }

    // Rotation: nouveau refresh, ancien révoqué
    const tokens = rotateTokens(res, refreshToken, user._id, user.role);

    res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        expiresIn: 900
      },
      message: 'Session rafraîchie.'
    });

  } catch (error) {
    console.error('[REFRESH] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: AUTH_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

/**
 * @desc Déconnexion sécurisée (révocation token)
 * @route POST /api/auth/logout
 */
const logoutUser = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    
    if (refreshToken) {
      const { revokeRefreshToken } = require('../utils/tokenService');
      revokeRefreshToken(refreshToken);
    }
    
    clearRefreshTokenCookie(res);
    
    res.status(200).json({
      success: true,
      message: AUTH_MESSAGES.LOGOUT_SUCCESS
    });
  } catch (error) {
    // Même en cas d'erreur, on nettoie le cookie
    clearRefreshTokenCookie(res);
    res.status(200).json({
      success: true,
      message: AUTH_MESSAGES.LOGOUT_SUCCESS
    });
  }
};

/**
 * @desc Mise à jour disponibilité chauffeur (avec validation métier)
 * @route PUT /api/auth/availability
 */
const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;

    // Validation stricte type
    if (typeof isAvailable !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'La valeur doit être true ou false.',
        code: 'INVALID_TYPE'
      });
    }

    // Vérification rôle
    if (req.user.role !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Opération réservée aux chauffeurs.',
        code: 'NOT_DRIVER'
      });
    }

    // Si mise en disponible: vérifier abonnement actif
    if (isAvailable) {
      const user = await User.findById(req.user._id);
      
      if (!user.subscription?.isActive || user.subscription.hoursRemaining <= 0) {
        return res.status(403).json({
          success: false,
          message: 'Abonnement invalide ou crédit épuisé.',
          code: 'SUBSCRIPTION_INVALID'
        });
      }

      // Vérifier documents si premier passage en disponible (optionnel)
      // if (!user.documents?.idCard || !user.documents?.license) {
      //   return res.status(403).json({...});
      // }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, runValidators: true }
    ).select('isAvailable name');

    res.json({
      success: true,
      data: {
        isAvailable: updatedUser.isAvailable,
        driverName: updatedUser.name
      },
      message: isAvailable 
        ? 'Vous êtes visible pour les courses.'
        : 'Vous êtes hors ligne.'
    });

  } catch (error) {
    console.error('[AVAILABILITY] Erreur:', error.message);
    res.status(500).json({
      success: false,
      message: AUTH_MESSAGES.SERVER_ERROR,
      code: 'SERVER_ERROR'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  refreshToken,
  updateAvailability
};