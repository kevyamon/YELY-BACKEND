// src/middleware/uploadMiddleware.js
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
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB global
});

const uploadSingle = upload.single('proofImage');
const uploadProfilePic = upload.single('profilePicture');
const uploadReportCaptures = upload.array('captures', 3); // MAX 3 CAPTURES

const validateFileSignature = (req, res, next) => {
  const files = req.file ? [req.file] : (req.files || []);
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      const buffer = Buffer.alloc(4);
      const fd = fs.openSync(file.path, 'r');
      fs.readSync(fd, buffer, 0, 4, 0);
      fs.closeSync(fd);
      const hex = buffer.toString('hex').toUpperCase();

      if (!hex.startsWith('FFD8') && hex !== '89504E47') {
        files.forEach(f => fs.unlinkSync(f.path));
        return errorResponse(res, "Type de fichier invalide détecté.", 400);
      }
    }
    next();
  } catch (error) {
    return errorResponse(res, "Erreur d'analyse sécuritaire.", 500);
  }
};

module.exports = { uploadSingle, uploadProfilePic, uploadReportCaptures, validateFileSignature };