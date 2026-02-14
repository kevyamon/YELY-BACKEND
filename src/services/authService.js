// src/services/authService.js
// SERVICE AUTH - Logique Création & Vérification (100% DB Driven)
// CSCSM Level: Bank Grade

const User = require('../models/User');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');

/**
 * Crée un utilisateur dans une transaction
 * @param {Object} userData - Données validées
 * @param {Object} session - Session Mongoose
 */
const createUserInTransaction = async (userData, session) => {
  const { email, phone, role } = userData;

  // 1. Vérification doublons (Double sécurité en plus de l'index unique)
  const existingUser = await User.findOne({ 
    $or: [{ email }, { phone }] 
  }).session(session);

  if (existingUser) {
    throw new AppError('Cet email ou ce numéro est déjà utilisé.', 409);
  }

  // 2. Sécurité Rôle Admin/SuperAdmin
  // On empêche la création directe d'admin via l'API publique
  if (['admin', 'superadmin'].includes(role)) {
    // Seul un superadmin connecté pourrait créer un autre admin (logique à gérer dans un AdminService)
    // Pour l'inscription publique, on force 'rider' ou 'driver'
    throw new AppError('Création de compte administrateur non autorisée ici.', 403);
  }

  // 3. Création
  const [user] = await User.create([userData], { session });
  
  return user;
};

/**
 * Vérifie les identifiants de connexion
 */
const verifyCredentials = async (identifier, password) => {
  // Recherche par Email ou Téléphone
  const user = await User.findOne({
    $or: [{ email: identifier }, { phone: identifier }]
  }).select('+password'); // On demande explicitement le mot de passe hashé

  if (!user) {
    throw new AppError('Identifiants incorrects.', 401);
  }

  // Vérification mot de passe (Méthode instance sécurisée)
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Identifiants incorrects.', 401);
  }

  if (user.isBanned) {
    throw new AppError(`Compte suspendu: ${user.banReason}`, 403);
  }

  return user;
};

module.exports = {
  createUserInTransaction,
  verifyCredentials
};