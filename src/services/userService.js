// src/services/userService.js
// SERVICE UTILISATEUR - Logique d'Identité & Audit
// CSCSM Level: Bank Grade

const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');

/**
 * Récupère le profil avec filtrage des champs sensibles
 */
const getUserProfile = async (userId) => {
  const user = await User.findById(userId).select('-password -__v');
  if (!user) throw new AppError('Utilisateur introuvable.', 404);
  return user;
};

/**
 * Mise à jour sécurisée du profil avec traçabilité
 */
const updateProfile = async (userId, updateData) => {
  // 1. Vérification des doublons email/téléphone (Logic déportée ici)
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

  // 2. Mise à jour
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true, select: '-password -__v' }
  );

  // 3. 🛡️ AUDIT LOG : On trace l'identité qui change (CRITIQUE pour la banque)
  await AuditLog.create({
    actor: userId,
    action: 'UPDATE_PROFILE',
    target: userId,
    details: `Champs modifiés: ${Object.keys(updateData).join(', ')}`
  });

  return user;
};

module.exports = {
  getUserProfile,
  updateProfile
};