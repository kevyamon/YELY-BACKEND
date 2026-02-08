const Transaction = require('../models/Transaction');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

// @desc    Envoyer une preuve de paiement (Capture d'écran)
// @route   POST /api/subscriptions/submit-proof
const submitProof = async (req, res) => {
  try {
    const { amount, type, senderPhone } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "Veuillez joindre une capture d'écran." });
    }

    // 1. Envoyer l'image vers Cloudinary (Dossier spécifique)
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'yely_proofs',
    });

    // 2. Supprimer immédiatement le fichier du serveur local (Indispensable sur Render)
    fs.unlinkSync(req.file.path);

    // 3. Logique d'Isolation Financière (Hebdo = Toi / Mensuel = AirMax)
    const assignedTo = (type === 'WEEKLY') ? 'SUPERADMIN' : 'PARTNER';

    // 4. Création de la transaction en attente (PENDING)
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

    res.status(201).json({
      message: "Preuve reçue ! Un admin vérifie votre paiement. Accès sous 10 minutes.",
      transactionId: transaction._id
    });

  } catch (error) {
    console.error("Erreur Upload Preuve:", error);
    res.status(500).json({ message: "Échec de l'envoi de la preuve." });
  }
};

module.exports = { submitProof };