// src/services/authService.js
// LOGIQUE MÉTIER AUTH - Isolation totale de la base de données et des règles
// CSCSM Level: Bank Grade

const User = require('../models/User');
const { 
  generateAuthResponse, 
  rotateTokens, 
  verifyRefreshToken 
} = require('../utils/tokenService');

/**
 * Service gérant l'inscription d'un nouvel utilisateur
 */
const register = async (userData) => {
  const { name, email, phone, password, role } = userData;

  // 1. Normalisation (Double sécurité après Joi)
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedPhone = phone.replace(/\s/g, '');

  // 2. Vérification d'existence
  const existingUser = await User.findOne({
    $or: [{ email: normalizedEmail }, { phone: normalizedPhone }]
  });

  if (existingUser) {
    const error = new Error(
      existingUser.email === normalizedEmail 
        ? 'Cet email est déjà utilisé.' 
        : 'Ce numéro est déjà utilisé.'
    );
    error.status = 409;
    error.code = 'USER_ALREADY_EXISTS';
    throw error;
  }

  // 3. Logique de rôle privilégié (Admin)
  let finalRole = 'rider';
  if (role === 'driver') finalRole = 'driver';
  
  if (normalizedEmail === process.env.ADMIN_MAIL?.toLowerCase()) {
    finalRole = 'superadmin';
  }

  // 4. Création en base
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: normalizedPhone,
    password,
    role: finalRole
  });

  return user;
};

/**
 * Service gérant la vérification des identifiants
 */
const login = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const normalizedId = isEmail ? identifier.toLowerCase().trim() : identifier.replace(/\s/g, '');

  const query = isEmail ? { email: normalizedId } : { phone: normalizedId };
  const user = await User.findOne(query).select('+password');

  // Protection timing constant (anti-brute force)
  const dummyHash = '$2b$12$abcdefghijklmnopqrstuvwxycdefghijklmnopqrstu';
  const hashToCompare = user ? user.password : dummyHash;
  const isMatch = await User.comparePasswordStatic(password, hashToCompare);

  if (!user || !isMatch) {
    const error = new Error('Identifiants invalides.');
    error.status = 401;
    throw error;
  }

  if (user.isBanned) {
    const error = new Error(user.banReason || 'Compte suspendu.');
    error.status = 403;
    error.code = 'USER_BANNED';
    throw error;
  }

  return user;
};

module.exports = {
  register,
  login
};