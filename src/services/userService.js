// src/services/userService.js
// SERVICE UTILISATEUR - Logique d'Identité & Audit
// CSCSM Level: Bank Grade

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const getUserProfile = async (userId) => {
  // AJOUT SENIOR: Populate de la souscription pour éviter le bug d'affichage frontend
  const user = await User.findById(userId)
    .populate('subscription')
    .select('-password -__v');
    
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
  ).populate('subscription');

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
    if (user.profilePicture && user.profilePicture.includes('cloudinary.com')) {
      const publicIdMatch = user.profilePicture.match(/\/v\d+\/([^/.]+)\./);
      if (publicIdMatch && publicIdMatch[1]) {
        await cloudinary.uploader.destroy(publicIdMatch[1]).catch(() => console.log('Ancienne photo non trouvée'));
      }
    }

    const result = await cloudinary.uploader.upload(file.path, {
      folder: 'yely/profiles',
      transformation: [{ width: 500, height: 500, crop: 'fill' }]
    });

    user.profilePicture = result.secure_url;
    await user.save();

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

  const randomSuffix = Math.random().toString(36).substring(2, 10);

  user.name = 'Utilisateur Supprimé';
  user.email = `deleted_${userId}_${randomSuffix}@yely.local`;
  user.phone = `DEL_${randomSuffix}`;
  user.profilePicture = '';
  user.isAvailable = false;
  user.isDeleted = true;
  user.fcmToken = null;
  user.password = await require('bcrypt').hash(randomSuffix, 10);

  if (user.vehicle) {
    user.vehicle.plate = 'DELETED';
  }

  await user.save({ validateBeforeSave: false });

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