const multer = require('multer');
const path = require('path');

// Configuration du stockage temporaire sur le serveur
const storage = multer.diskStorage({
  filename: function (req, file, cb) {
    cb(null, file.fieldname + "-" + Date.now() + path.extname(file.originalname));
  }
});

// Filtre pour n'accepter que les images (Sécurité Forteresse)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new Error('Le fichier doit être une image !'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // Limite à 5MB
});

module.exports = upload;