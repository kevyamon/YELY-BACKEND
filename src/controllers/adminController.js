const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const cloudinary = require('../config/cloudinary');

// 1. GESTION DES RÔLES (SUPERADMIN ONLY)
exports.updateAdminStatus = async (req, res) => {
  const { userId, action } = req.body; // action: 'PROMOTE' ou 'REVOKE'
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable." });

    user.role = (action === 'PROMOTE') ? 'admin' : 'rider';
    await user.save();
    res.status(200).json({ message: `L'utilisateur est désormais ${user.role}.` });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la mise à jour du rôle." });
  }
};

// 2. DISCIPLINE : BANNIR / DÉBANNIR
exports.toggleUserBan = async (req, res) => {
  const { userId, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Utilisateur introuvable." });
    if (user.role === 'superadmin') return res.status(403).json({ message: "Action impossible sur le Créateur." });

    user.isBanned = !user.isBanned;
    user.banReason = user.isBanned ? reason : "";
    await user.save();

    res.status(200).json({ message: user.isBanned ? "Utilisateur banni." : "Bannissement levé." });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'action disciplinaire." });
  }
};

// 3. GESTION DE LA CARTE (LOCK MAFÉRÉ)
exports.updateMapSettings = async (req, res) => {
  const { isMapLocked, serviceCity, radius } = req.body;
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});

    settings.isMapLocked = isMapLocked;
    settings.serviceCity = serviceCity;
    settings.allowedRadiusKm = radius;
    await settings.save();

    res.status(200).json({ message: `Zone de service mise à jour : ${serviceCity}.` });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la configuration de la carte." });
  }
};

// 4. VALIDATION DES PAIEMENTS
exports.getValidationQueue = async (req, res) => {
  try {
    let query = { status: 'PENDING' };
    if (req.user.role === 'admin') query.assignedTo = 'PARTNER';
    
    const transactions = await Transaction.find(query).populate('driver', 'name phone vehicle');
    res.status(200).json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Erreur récupération file d'attente." });
  }
};

exports.approveTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: "Transaction introuvable." });

    const driver = await User.findById(transaction.driver);
    const hoursToAdd = (transaction.type === 'WEEKLY') ? 168 : 720;

    driver.subscription.isActive = true;
    driver.subscription.hoursRemaining += hoursToAdd;
    driver.subscription.lastCheckTime = Date.now();
    await driver.save();

    transaction.status = 'APPROVED';
    transaction.validatedBy = req.user._id;
    await transaction.save();

    if (transaction.proofPublicId) await cloudinary.uploader.destroy(transaction.proofPublicId);

    res.status(200).json({ message: "Abonnement activé." });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'approbation." });
  }
};

exports.rejectTransaction = async (req, res) => {
  const { reason } = req.body;
  try {
    const transaction = await Transaction.findById(req.params.id);
    transaction.status = 'REJECTED';
    transaction.rejectionReason = reason;
    await transaction.save();

    if (transaction.proofPublicId) await cloudinary.uploader.destroy(transaction.proofPublicId);
    res.status(200).json({ message: "Transaction rejetée." });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du rejet." });
  }
};

// 5. GHOST MODE USERS LIST
exports.getAllUsers = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'admin') query = { role: { $ne: 'superadmin' } };
    
    const users = await User.find(query).select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Erreur récupération utilisateurs." });
  }
};