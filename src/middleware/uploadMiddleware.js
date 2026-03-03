// src/middleware/uploadMiddleware.js
// MIDDLEWARE UPLOAD - Anti-Spoofing & Magic Numbers
// CSCSM Level: Bank Grade

const multer = require('multer');
const fs = require('fs');
const { errorResponse } = require('../utils/responseHandler');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/temp';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, ''));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Différents points d'entrée selon le besoin
const uploadSingle = upload.single('proofImage');
const uploadProfilePic = upload.single('profilePicture');

const validateFileSignature = (req, res, next) => {
  if (!req.file) return next();

  try {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(req.file.path, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
    
    const hex = buffer.toString('hex').toUpperCase();

    if (hex.startsWith('FFD8') || hex === '89504E47') {
      return next();
    } else {
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
  uploadProfilePic,
  validateFileSignature
};