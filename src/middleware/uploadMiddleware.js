// src/middleware/uploadMiddleware.js
// UPLOAD SÉCURISÉ - Inspection Binaire (Magic Bytes), Sandboxing & Nettoyage
// CSCSM Level: Bank Grade

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const FileType = require('file-type');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

// Dossier temporaire sécurisé (Sandboxed)
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
}

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// 🔒 SÉCURITÉ : On limite strictement à 2 Mo pour économiser le stockage et la bande passante
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// 1. Configuration du stockage Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    // Nom de fichier totalement aléatoire pour éviter les collisions et l'énumération
    const randomName = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${ext}`);
  }
});

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
 * Inspecte la signature réelle du fichier sur le disque.
 */
const validateFileSignature = async (req, res, next) => {
  if (!req.file) return next();

  const filePath = req.file.path;

  try {
    // Lecture des premiers octets pour déterminer le type réel
    const type = await FileType.fromFile(filePath);

    // Si le type est indéterminé ou non autorisé, on rejette
    if (!type || !ALLOWED_MIMES.includes(type.mime)) {
      // Suppression immédiate du fichier suspect
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      
      logger.warn(`[SECURITY] Tentative d'upload de fichier malveillant bloquée. Type réel: ${type?.mime || 'inconnu'}`);
      return next(new AppError('Contenu du fichier invalide ou corrompu (Échec Magic Bytes).', 400));
    }

    // Cohérence : Le type réel doit correspondre à l'extension
    const extFromType = `.${type.ext}`;
    const currentExt = path.extname(req.file.filename).toLowerCase();
    
    // On autorise .jpg pour image/jpeg
    const isJpegMatch = (type.ext === 'jpg' || type.ext === 'jpeg') && (currentExt === '.jpg' || currentExt === '.jpeg');
    
    if (!isJpegMatch && extFromType !== currentExt) {
       if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
       return next(new AppError('Incohérence entre l\'extension et le contenu réel.', 400));
    }

    next();
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    logger.error(`[UPLOAD ERROR] Erreur lors de la validation binaire: ${error.message}`);
    next(new AppError('Erreur lors du traitement de la sécurité du fichier.', 500));
  }
};

module.exports = {
  uploadSingle: upload.single('file'), // 'file' est le champ attendu
  validateFileSignature
};