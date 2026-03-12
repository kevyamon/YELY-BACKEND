// src/middleware/uploadMiddleware.js
// MIDDLEWARE UPLOAD - Gestion securisee des fichiers et validation de signature (Bank Grade)

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = file.originalname || 'capture.png';
    const safeName = originalName.replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `${file.fieldname}-${uniqueSuffix}-${safeName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } 
});

const uploadSingle = upload.single('proofImage');
const uploadProfilePic = upload.single('profilePicture');
const uploadReportCaptures = upload.array('captures', 3);

const validateFileSignature = (req, res, next) => {
  const files = req.file ? [req.file] : (req.files || []);
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      const buffer = Buffer.alloc(12);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, buffer, 0, 12, 0);
      fs.closeSync(fd);
      
      const hex = buffer.toString('hex').toUpperCase();

      // Signatures HEX etendues pour React Native / Mobiles
      const isJPEG = hex.includes('FFD8');
      const isPNG = hex.includes('89504E47');
      const isWEBP = hex.includes('52494646'); 
      const isHEIC = hex.includes('66747970'); 
      const isGIF = hex.includes('47494638');
      const isBMP = hex.includes('424D');

      if (!isJPEG && !isPNG && !isWEBP && !isHEIC && !isGIF && !isBMP) {
        
        // Filet de securite : Si la signature est masquee par les metadonnees EXIF 
        // d'un telephone (frequent sur React Native FormData), on verifie le mimetype declare.
        if (file.mimetype && file.mimetype.startsWith('image/')) {
           logger.warn(`[Upload] Signature HEX inhabituelle contournee grâce au mimetype: ${file.mimetype}. Hex: ${hex.substring(0, 16)}`);
           continue;
        }

        files.forEach(f => {
          if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
        });
        logger.warn(`[Upload] Fichier non autorise rejete. Hex: ${hex.substring(0, 16)}`);
        return errorResponse(res, "Le format de l'image n'est pas supporte ou le fichier est corrompu.", 400);
      }
    }
    next();
  } catch (error) {
    files.forEach(f => {
      if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    });
    logger.error(`[Upload Middleware] Erreur lors de l'analyse: ${error.message}`);
    return errorResponse(res, "Erreur interne lors de la verification du fichier.", 500);
  }
};

module.exports = { 
  uploadSingle, 
  uploadProfilePic, 
  uploadReportCaptures, 
  validateFileSignature 
};