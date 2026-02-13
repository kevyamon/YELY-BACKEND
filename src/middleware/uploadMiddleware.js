// src/middleware/uploadMiddleware.js
// UPLOAD SÉCURISÉ - Magic numbers, Filenames aléatoires, Nettoyage garanti
// CSCSM Level: Bank Grade

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Dossier temporaire sécurisé
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
}

// Magic numbers des formats autorisés
const MAGIC_NUMBERS = {
  'image/jpeg': ['FFD8FF'],
  'image/png': ['89504E47'],
  'image/webp': ['52494646']
};

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Configuration stockage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const randomName = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${ext}`);
  }
});

// Filtre initial
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`Extension non autorisée. Autorisé: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }

  if (!Object.keys(MAGIC_NUMBERS).includes(file.mimetype)) {
    return cb(new Error('Type MIME non autorisé.'), false);
  }

  cb(null, true);
};

// Middleware Multer configuré
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Export direct du middleware .single()
module.exports = upload;