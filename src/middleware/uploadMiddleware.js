// src/middleware/uploadMiddleware.js
// MIDDLEWARE UPLOAD - Anti-Spoofing & Magic Numbers
// CSCSM Level: Bank Grade

const multer = require('multer');
const fs = require('fs');
const { errorResponse } = require('../utils/responseHandler');

// Stockage temporaire local avant l'envoi vers Cloudinary
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/temp';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'proof-' + uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, ''));
  }
});

// Limite de taille stricte : 5MB maximum
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadSingle = upload.single('proofImage');

/**
 * Validation par "Magic Numbers" (ADN du fichier)
 * Empêche un hacker de renommer un script.exe en image.png
 */
const validateFileSignature = (req, res, next) => {
  if (!req.file) {
    return next(); // Laisse le validateur Zod ou le Controller gérer l'absence de fichier
  }

  try {
    // Lecture des 4 premiers octets du fichier
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(req.file.path, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    const hex = buffer.toString('hex').toUpperCase();

    // Signatures hexadécimales standard
    // JPEG commence par FFD8
    // PNG commence par 89504E47
    if (hex.startsWith('FFD8') || hex === '89504E47') {
      return next();
    } else {
      // Destruction immédiate du fichier malveillant
      fs.unlinkSync(req.file.path);
      console.warn(`[SECURITY] Tentative de spoofing MIME détectée par l'utilisateur ${req.user?._id || 'Inconnu'}`);
      return errorResponse(res, "Fichier corrompu ou format non autorisé. Seules les vraies images JPEG/PNG sont acceptées.", 400);
    }
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return errorResponse(res, "Erreur lors de l'analyse sécuritaire du fichier.", 500);
  }
};

module.exports = {
  uploadSingle,
  validateFileSignature
};