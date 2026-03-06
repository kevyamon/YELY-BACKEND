// src/middleware/uploadMiddleware.js
// MIDDLEWARE UPLOAD - Gestion securisee des fichiers et validation de signature (Bank Grade)

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Utilisation d'un chemin absolu pour eviter les erreurs de dossier selon l'execution
    const dir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Securite: React Native FormData n'envoie pas toujours originalname
    const originalName = file.originalname || 'capture.png';
    const safeName = originalName.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${file.fieldname}-${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB global maximum
});

const uploadSingle = upload.single('proofImage');
const uploadProfilePic = upload.single('profilePicture');
const uploadReportCaptures = upload.array('captures', 3); // MAX 3 CAPTURES

const validateFileSignature = (req, res, next) => {
  const files = req.file ? [req.file] : (req.files || []);
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      // Lecture des 12 premiers octets pour couvrir plus de formats (HEIC a besoin de 12)
      const buffer = Buffer.alloc(12);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);
      
      const hex = buffer.toString('hex').toUpperCase();

      // Signatures HEX (Magic Numbers)
      const isJPEG = hex.startsWith('FFD8');
      const isPNG = hex.startsWith('89504E47');
      const isWEBP = hex.startsWith('52494646'); // RIFF
      const isHEIC = hex.includes('66747970'); // ftypheic ou similaire

      if (!isJPEG && !isPNG && !isWEBP && !isHEIC) {
        // Nettoyage immediat du fichier suspect
        files.forEach(f => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        logger.warn(`[Upload] Tentative d'upload de fichier non autorisé. Hex: ${hex.substring(0, 16)}`);
        return errorResponse(res, "Le format de l'image n'est pas supporté (JPG, PNG, WEBP, HEIC uniquement).", 400);
      }
    }
    next();
  } catch (error) {
    // En cas de crash fs, on s'assure de nettoyer la memoire
    files.forEach(f => {
      if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
    logger.error(`[Upload Middleware] Erreur lors de l'analyse sécuritaire: ${error.message}`);
    return errorResponse(res, "Erreur interne lors de la vérification du fichier.", 500);
  }
};

module.exports = { 
  uploadSingle, 
  uploadProfilePic, 
  uploadReportCaptures, 
  validateFileSignature 
};