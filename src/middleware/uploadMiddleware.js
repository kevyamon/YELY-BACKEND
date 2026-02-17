// src/middleware/uploadMiddleware.js
// UPLOAD SÉCURISÉ - Inspection Binaire en RAM (Magic Bytes) & Zéro Écriture Disque
// CSCSM Level: Bank Grade

const multer = require('multer');
const FileType = require('file-type');
const path = require('path');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// 🔒 SÉCURITÉ : Limite stricte à 2 Mo pour protéger la RAM
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// 1. Configuration du stockage en RAM (Memory Storage) 
// Évite la saturation du disque (Disk Exhaustion DoS) et accélère le transfert vers Cloudinary.
const storage = multer.memoryStorage();

// 2. Filtre superficiel (Extension & MIME déclaré)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new AppError(`Extension ${ext} non autorisée.`, 400), false);
  }

  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(new AppError('Type MIME déclaré invalide.', 400), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 }
});

/**
 * 🛡️ MIDDLEWARE DE VALIDATION BINAIRE (Magic Bytes)
 * Inspecte la signature réelle du fichier directement dans le buffer (RAM).
 */
const validateFileSignature = async (req, res, next) => {
  if (!req.file) return next();

  try {
    // Lecture des premiers octets depuis la mémoire vive
    const type = await FileType.fromBuffer(req.file.buffer);

    // Si le type est indéterminé ou non autorisé, on rejette purement et simplement
    if (!type || !ALLOWED_MIMES.includes(type.mime)) {
      logger.warn(`[SECURITY] Tentative d'upload de fichier malveillant bloquée. Type réel: ${type?.mime || 'inconnu'}`);
      return next(new AppError('Contenu du fichier invalide ou corrompu (Échec Magic Bytes).', 400));
    }

    // Cohérence : Le type réel doit correspondre à l'extension
    const extFromType = `.${type.ext}`;
    const currentExt = path.extname(req.file.originalname).toLowerCase(); 
    
    // On autorise .jpg pour image/jpeg
    const isJpegMatch = (type.ext === 'jpg' || type.ext === 'jpeg') && (currentExt === '.jpg' || currentExt === '.jpeg');
    
    if (!isJpegMatch && extFromType !== currentExt) {
       return next(new AppError('Incohérence entre l\'extension et le contenu réel.', 400));
    }

    next();
  } catch (error) {
    logger.error(`[UPLOAD ERROR] Erreur lors de la validation binaire: ${error.message}`);
    next(new AppError('Erreur lors du traitement de la sécurité du fichier.', 500));
  }
};

module.exports = {
  uploadSingle: upload.single('file'), 
  validateFileSignature
};