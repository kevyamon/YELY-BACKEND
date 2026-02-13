// src/middleware/uploadMiddleware.js
// UPLOAD SÉCURISÉ - Magic numbers, Filenames aléatoires, Nettoyage garanti
// CSCSM Level: Bank Grade

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');

const unlinkAsync = promisify(fs.unlink);

// Dossier temporaire sécurisé
const TEMP_DIR = path.join(__dirname, '../../temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
}

// Magic numbers des formats autorisés (vérification réelle du fichier)
const MAGIC_NUMBERS = {
  'image/jpeg': ['FFD8FF'],                           // JPEG
  'image/png': ['89504E47'],                          // PNG
  'image/webp': ['52494646']                          // WEBP (RIFF header)
};

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Vérifie le type réel d'un fichier via magic numbers
 * @param {string} filePath - Chemin du fichier
 * @returns {Promise<string|null>} MIME type détecté ou null
 */
const detectRealMimeType = async (filePath) => {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const hexHeader = buffer.toString('hex').toUpperCase();

    for (const [mime, signatures] of Object.entries(MAGIC_NUMBERS)) {
      for (const signature of signatures) {
        if (hexHeader.startsWith(signature)) {
          return mime;
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[MAGIC NUMBERS] Erreur:', error.message);
    return null;
  }
};

// Configuration stockage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    // Nom aléatoire cryptographique (pas de fuite d'info)
    const randomName = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomName}${ext}`);
  }
});

// Filtre initial (extension + MIME déclaré)
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

// Configuration Multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1 // Un seul fichier par requête
  }
});

/**
 * Middleware de vérification magic numbers (après upload)
 * Vérifie que le contenu réel correspond à l'extension
 */
const verifyMagicNumbers = async (req, res, next) => {
  if (!req.file) {
    return next(); // Pas de fichier, laisse le contrôleur gérer
  }

  try {
    const realMimeType = await detectRealMimeType(req.file.path);
    
    if (!realMimeType) {
      await unlinkAsync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Format fichier non reconnu ou corrompu.',
        code: 'INVALID_FILE_TYPE'
      });
    }

    if (realMimeType !== req.file.mimetype) {
      // Spoofing détecté !
      console.warn(`[SECURITY] MIME spoofing détecté: déclaré=${req.file.mimetype}, réel=${realMimeType}, IP=${req.ip}`);
      await unlinkAsync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Type fichier invalide (détection spoofing).',
        code: 'MIME_MISMATCH'
      });
    }

    // Vérification taille réelle (anti-compression bomb)
    const stats = fs.statSync(req.file.path);
    if (stats.size > MAX_FILE_SIZE) {
      await unlinkAsync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Fichier trop volumineux (max 5MB).',
        code: 'FILE_TOO_LARGE'
      });
    }

    // Ajouter info vérifiée pour le contrôleur
    req.file.verifiedMimeType = realMimeType;
    
    next();
  } catch (error) {
    // Nettoyage en cas d'erreur
    if (req.file?.path && fs.existsSync(req.file.path)) {
      await unlinkAsync(req.file.path).catch(() => {});
    }
    next(error);
  }
};

/**
 * Middleware de nettoyage en cas d'erreur route
 * Garantit suppression fichier temp même si crash
 */
const cleanupOnError = async (err, req, res, next) => {
  if (req.file?.path && fs.existsSync(req.file.path)) {
    try {
      await unlinkAsync(req.file.path);
      console.log(`[CLEANUP] Fichier supprimé: ${path.basename(req.file.path)}`);
    } catch (cleanupErr) {
      console.error('[CLEANUP] Échec:', cleanupErr.message);
    }
  }
  next(err);
};

/**
 * Nettoyage périodique des fichiers orphelins (cron job optionnel)
 */
const cleanupOrphanFiles = async () => {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 heure

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        await unlinkAsync(filePath);
        console.log(`[CRON] Orphelin supprimé: ${file}`);
      }
    }
  } catch (error) {
    console.error('[CRON CLEANUP] Erreur:', error.message);
  }
};

// Exporter cleanup pour utilisation externe (node-cron)
module.exports = {
  upload: upload.single('image'),
  verifyMagicNumbers,
  cleanupOnError,
  cleanupOrphanFiles
};