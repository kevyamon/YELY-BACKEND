// src/services/userService.js
// SERVICE UTILISATEUR - Logique d'Identité & Audit
// CSCSM Level: Bank Grade

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const cloudinary = require('cloudinary').v2; // On utilise le SDK Cloudinary
const fs = require('fs');

const getUserProfile = async (userId) => {
  const user = await User.findById(userId).select('-password -__v');
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  return user;
};

const updateProfile = async (userId, updateData) => {
  if (updateData.email || updateData.phone) {
    const existing = await User.findOne({
      $and: [
        { _id: { $ne: userId } },
        { $or: [
          { email: updateData.email || 'null' },
          { phone: updateData.phone || 'null' }
        ]}
      ]
    });
    
    if (existing) {
      const field = existing.email === updateData.email ? 'email' : 'téléphone';
      throw new AppError(`Cet ${field} est déjà utilisé.`, 409);
    }
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true, select: '-password -__v' }
  );

  await AuditLog.create({
    actor: userId,
    action: 'UPDATE_PROFILE',
    target: userId,
    details: `Champs modifiés: ${Object.keys(updateData).join(', ')}`
  }).catch(() => {});

  return user;
};

const uploadProfilePicture = async (userId, file) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);

  try {
    // 1. Nettoyage de l'ancienne photo sur Cloudinary pour économiser l'espace
    if (user.profilePicture && user.profilePicture.includes('cloudinary.com')) {
      const publicIdMatch = user.profilePicture.match(/\/v\d+\/([^/.]+)\./);
      if (publicIdMatch && publicIdMatch[1]) {
        await cloudinary.uploader.destroy(publicIdMatch[1]).catch(() => console.log('Ancienne photo non trouvée'));
      }
    }

    // 2. Upload de la nouvelle photo
    const result = await cloudinary.uploader.upload(file.path, {
      folder: 'yely/profiles',
      transformation: [{ width: 500, height: 500, crop: 'fill' }] // Optimisation stricte
    });

    user.profilePicture = result.secure_url;
    await user.save();

    // 3. Nettoyage du fichier local
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    return user;
  } catch (error) {
    if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    throw new AppError("Échec de l'upload de l'image.", 500);
  }
};

const anonymizeAccount = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable.', 404);

  // Génération d'un identifiant poubelle unique
  const randomSuffix = Math.random().toString(36).substring(2, 10);

  user.name = 'Utilisateur Supprimé';
  user.email = `deleted_${userId}_${randomSuffix}@yely.local`;
  user.phone = `DEL_${randomSuffix}`;
  user.profilePicture = '';
  user.isAvailable = false;
  user.isDeleted = true;
  user.fcmToken = null;
  user.password = await require('bcrypt').hash(randomSuffix, 10); // Brouillage du mot de passe

  if (user.vehicle) {
    user.vehicle.plate = 'DELETED';
  }

  await user.save({ validateBeforeSave: false }); // On désactive la validation stricte pour l'anonymisation

  await AuditLog.create({
    actor: userId,
    action: 'DELETE_ACCOUNT',
    target: userId,
    details: 'Compte anonymisé (Soft Delete) à la demande de l\'utilisateur.'
  }).catch(() => {});

  return true;
};

module.exports = {
  getUserProfile,
  updateProfile,
  uploadProfilePicture,
  anonymizeAccount
};