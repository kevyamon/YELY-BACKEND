// src/controllers/userController.js
// CONTROLEUR UTILISATEUR - Gestion Profil & Disponibilite
// CSCSM Level: Bank Grade (Modularisé)

const User = require('../models/User');
const Product = require('../models/Product');
const userService = require('../services/userService');
const authService = require('../services/authService');
const { clearRefreshTokenCookie } = require('../utils/tokenService');
const { successResponse } = require('../utils/responseHandler');
const AppError = require('../utils/AppError');
const { getOrCreateSellerSlug } = require('./userShareController');

const getProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserProfile(req.user._id);
    if (user && user.role === 'seller' && !user.shopSlug) {
      await getOrCreateSellerSlug(user);
    }
    return successResponse(res, user, 'Profil recupere');
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedUpdates = ['name', 'phone', 'vehicle', 'hasFollowedFB'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) throw new AppError('Mise a jour non autorisee', 400);

    const user = await userService.updateProfile(req.user._id, req.body);
    return successResponse(res, user, 'Profil mis a jour');
  } catch (error) {
    return next(error);
  }
};

const uploadProfilePicture = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError("Aucune image fournie", 400);
    const user = await userService.uploadProfilePicture(req.user._id, req.file);
    return successResponse(res, { profilePicture: user.profilePicture }, 'Photo de profil mise a jour');
  } catch (error) {
    return next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    await userService.anonymizeAccount(req.user._id);
    
    // Purge de la session
    clearRefreshTokenCookie(res);
    const redisClient = require('../config/redis');
    try { await redisClient.del(`auth:user:${req.user._id}`); } catch(e) {}

    return successResponse(res, null, 'Compte supprime definitivement');
  } catch (error) {
    return next(error);
  }
};

const updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    
    if (typeof isAvailable !== 'boolean') {
      throw new AppError('Statut de disponibilite invalide', 400);
    }

    const user = await authService.updateAvailability(req.user._id, isAvailable);

    return successResponse(res, {
      isAvailable: user.isAvailable,
      totalRides: user.totalRides,
      totalEarnings: user.totalEarnings,
      rating: user.rating
    }, `Vous etes maintenant ${isAvailable ? 'en service' : 'hors ligne'}`);
  } catch (error) {
    return next(error);
  }
};

const updateShopLocation = async (req, res, next) => {
  try {
    const { coordinates, address } = req.body;

    if (req.user.role !== 'seller') {
      throw new AppError('Seuls les vendeurs peuvent définir la localisation de leur boutique.', 403);
    }

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      throw new AppError('Coordonnées invalides. Un tableau [longitude, latitude] est requis.', 400);
    }

    const [longitude, latitude] = coordinates.map(Number);

    if (isNaN(longitude) || isNaN(latitude)) {
      throw new AppError('Les coordonnées doivent être des nombres valides.', 400);
    }

    // Validation géographique stricte pour l'index 2dsphere
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new AppError('Coordonnées géographiques hors limites.', 400);
    }

    if (!address || typeof address !== 'string' || address.trim() === '') {
      throw new AppError('L\'adresse de la boutique est requise.', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        address: address.trim()
      },
      { new: true, runValidators: true }
    ).select('name email role currentLocation address');

    return successResponse(res, user, 'Localisation de la boutique mise à jour avec succès.');
  } catch (error) {
    return next(error);
  }
};

const getSellers = async (req, res, next) => {
  try {
    const { search } = req.query;
    const query = { role: 'seller', isBanned: false, isDeleted: false };
    if (search) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    const sellers = await User.find(query).select('name profilePicture rating');
    const sellersWithCount = await Promise.all(sellers.map(async (seller) => {
      const count = await Product.countDocuments({ seller: seller._id, isActive: true });
      return {
        ...seller.toObject(),
        productCount: count
      };
    }));
    return successResponse(res, sellersWithCount, 'Vendeurs récupérés avec succès');
  } catch (error) {
    return next(error);
  }
};

const getSellerProfile = async (req, res, next) => {
  try {
    const idOrSlug = req.params.id;
    let query = { role: 'seller', isBanned: false, isDeleted: false };
    
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      query._id = idOrSlug;
    } else {
      query.shopSlug = idOrSlug;
    }

    const seller = await User.findOne(query).select('name profilePicture rating email phone shopSlug');
    if (!seller) {
      throw new AppError('Vendeur introuvable', 404);
    }
    if (!seller.shopSlug) {
      await getOrCreateSellerSlug(seller);
    }
    const count = await Product.countDocuments({ seller: seller._id, isActive: true });
    return successResponse(res, {
      ...seller.toObject(),
      productCount: count
    }, 'Profil vendeur récupéré');
  } catch (error) {
    return next(error);
  }
};

const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await userService.updatePassword(req.user._id, currentPassword, newPassword);
    return successResponse(res, null, 'Votre mot de passe a ete modifie avec succes.');
  } catch (error) {
    return next(error);
  }
};

const verifyIdentity = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { vehicleType } = req.body;

    if (req.user.role !== 'driver') {
      throw new AppError('Seuls les chauffeurs peuvent soumettre une vérification d\'identité.', 403);
    }

    if (vehicleType && !['salonie', 'apsonic'].includes(vehicleType)) {
      throw new AppError('Type de véhicule invalide. Doit être salonie ou apsonic.', 400);
    }

    const user = await User.findById(userId);
    if (!user) throw new AppError('Utilisateur introuvable.', 404);

    const updateData = {};
    if (vehicleType) {
      updateData['vehicle.type'] = vehicleType;
    }

    // Upload sur Cloudinary si des fichiers sont fournis
    if (req.files) {
      const cloudinary = require('../config/cloudinary');
      const fs = require('fs');

      if (req.files.idCardFront && req.files.idCardFront[0]) {
        const file = req.files.idCardFront[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/verifications',
          transformation: [{ width: 1200, height: 900, crop: 'limit' }]
        });
        updateData['documents.idCardFront'] = result.secure_url;
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }

      if (req.files.idCardBack && req.files.idCardBack[0]) {
        const file = req.files.idCardBack[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/verifications',
          transformation: [{ width: 1200, height: 900, crop: 'limit' }]
        });
        updateData['documents.idCardBack'] = result.secure_url;
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    // Si on a à la fois le recto, le verso et le type de véhicule, le statut passe en pending
    const finalFront = updateData['documents.idCardFront'] || user.documents?.idCardFront;
    const finalBack = updateData['documents.idCardBack'] || user.documents?.idCardBack;
    const finalType = updateData['vehicle.type'] || user.vehicle?.type;

    if (finalFront && finalBack && finalType) {
      updateData.verificationStatus = 'pending';
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true, select: '-password -__v' }
    );

    return successResponse(res, updatedUser, 'Demande de vérification enregistrée avec succès.');
  } catch (error) {
    if (req.files) {
      const fs = require('fs');
      Object.values(req.files).flat().forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }
    return next(error);
  }
};

module.exports = { 
  getProfile, 
  updateProfile, 
  uploadProfilePicture,
  deleteAccount,
  updateAvailability,
  updateShopLocation,
  getSellers,
  getSellerProfile,
  updatePassword,
  verifyIdentity
};