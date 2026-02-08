const Transaction = require('../models/Transaction');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * @desc    Envoyer une preuve de paiement (Capture d'écran)
 * @route   POST /api/subscriptions/submit-proof
 */
const submitProof = async (req, res) => {
  const { amount, type, senderPhone } = req.body;

  if (!req.file) {
    return res.status(400).json({ message: "Veuillez joindre une capture d'écran." });
  }

  try {
    // 1. Tentative d'upload vers Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'yely_proofs',
    });

    // 2. Logique d'Isolation Financière
    const assignedTo = (type === 'WEEKLY') ? 'SUPERADMIN' : 'PARTNER';

    // 3. Création de la transaction en attente
    const transaction = await Transaction.create({
      driver: req.user._id,
      amount,
      type,
      senderPhone,
      proofImageUrl: result.secure_url,
      proofPublicId: result.public_id,
      assignedTo,
      status: 'PENDING'
    });

    return res.status(201).json({
      message: "Preuve reçue ! Un admin vérifie votre paiement. Accès sous 10 minutes.",
      transactionId: transaction._id
    });

  } catch (error) {
    console.error("Erreur Upload Preuve:", error);
    return res.status(500).json({ message: "Échec de l'envoi de la preuve." });
  } finally {
    // 4. NETTOYAGE SYSTÉMATIQUE (HYGIÈNE FORTERESSE)
    // On vérifie si le fichier existe encore sur le disque local avant de le supprimer
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
};

module.exports = { submitProof };