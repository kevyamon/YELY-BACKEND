// src/services/authService.js
// LOGIQUE MÉTIER AUTH - Exécution atomique
// CSCSM Level: Bank Grade

const User = require('../models/User');

/**
 * Crée un utilisateur dans la base de données (Au sein d'une transaction)
 * @param {Object} userData - Données validées et normalisées
 * @param {Object} session - Session Mongoose pour la transaction (OBLIGATOIRE)
 */
const createUserInTransaction = async (userData, session) => {
  const { name, email, phone, password, role } = userData;

  // 1. Vérification ultime d'unicité (Sécurité concurrente)
  const existingUser = await User.findOne({
    $or: [{ email }, { phone }]
  }).session(session);

  if (existingUser) {
    const field = existingUser.email === email ? 'email' : 'téléphone';
    throw { 
      status: 409, 
      message: `Cet ${field} est déjà utilisé par un autre compte.`,
      code: `DUPLICATE_${field.toUpperCase()}`
    };
  }

  // 2. Détermination sécurisée du rôle
  let finalRole = 'rider';
  if (role === 'driver') finalRole = 'driver';
  
  // SuperAdmin via ENV uniquement
  if (email === process.env.ADMIN_MAIL?.toLowerCase()) {
    finalRole = 'superadmin';
  }

  // 3. Création atomique
  const [newUser] = await User.create([{
    name,
    email,
    phone,
    password, // Le hook pre-save va le hasher
    role: finalRole,
    isAvailable: false,
    subscription: { isActive: false, hoursRemaining: 0 }
  }], { session });

  return newUser;
};

/**
 * Vérifie les identifiants utilisateur (Login)
 */
const verifyCredentials = async (identifier, password) => {
  const isEmail = identifier.includes('@');
  const query = isEmail ? { email: identifier } : { phone: identifier };

  const user = await User.findOne(query).select('+password');

  // Protection Timing Attack
  const dummyHash = '$2b$12$abcdefghijklmnopqrstuvwxycdefghijklmnopqrstu';
  const hashToCompare = user ? user.password : dummyHash;
  const isMatch = await User.comparePasswordStatic(password, hashToCompare);

  if (!user || !isMatch) {
    throw { status: 401, message: 'Identifiants invalides.', code: 'INVALID_CREDENTIALS' };
  }

  if (user.isBanned) {
    throw { status: 403, message: 'Compte suspendu.', code: 'USER_BANNED' };
  }

  return user;
};

module.exports = {
  createUserInTransaction,
  verifyCredentials
};