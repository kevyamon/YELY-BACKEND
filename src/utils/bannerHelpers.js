// src/utils/bannerHelpers.js
// HELPERS BANNIERES - Gestion des fichiers, Cloudinary et signaux temps réel
// STANDARD: Industriel / Bank Grade

const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

/**
 * Extrait le public_id Cloudinary depuis une URL sécurisée pour le nettoyage des ressources.
 */
const extractPublicId = (url) => {
  if (!url || !url.includes('/upload/')) return null;
  try {
    const parts = url.split('/upload/');
    let publicIdWithFormat = parts[1];
    
    if (publicIdWithFormat.startsWith('v')) {
      const slashIndex = publicIdWithFormat.indexOf('/');
      if (slashIndex !== -1) {
        publicIdWithFormat = publicIdWithFormat.substring(slashIndex + 1);
      }
    }
    
    const dotIndex = publicIdWithFormat.lastIndexOf('.');
    if (dotIndex !== -1) {
      return publicIdWithFormat.substring(0, dotIndex);
    }
    return publicIdWithFormat;
  } catch (err) {
    logger.error(`[CLOUDINARY] Echec de l'extraction du public_id: ${err.message}`);
    return null;
  }
};

/**
 * Émet un signal de mise à jour temps réel à tous les clients connectés.
 */
const broadcastBannersUpdate = (req) => {
  const io = req.app.get('socketio');
  if (io) {
    io.emit('banners_updated');
    logger.info('[SOCKET] Signal banners_updated émis globalement.');
  }
};

/**
 * Gère le téléversement d'image et vidéo vers Cloudinary avec nettoyage automatique du disque local.
 */
const uploadBannerFiles = async (files) => {
  let imageUrl = null;
  let videoUrl = null;

  const cleanUpFiles = () => {
    if (files) {
      if (files.image && files.image[0]) {
        const path = files.image[0].path;
        if (fs.existsSync(path)) fs.unlinkSync(path);
      }
      if (files.video && files.video[0]) {
        const path = files.video[0].path;
        if (fs.existsSync(path)) fs.unlinkSync(path);
      }
    }
  };

  try {
    if (files && files.image && files.image[0]) {
      const file = files.image[0];
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'yely/banners',
        resource_type: 'image'
      });
      imageUrl = result.secure_url;
    }

    if (files && files.video && files.video[0]) {
      const file = files.video[0];
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'yely/banners',
        resource_type: 'video'
      });
      videoUrl = result.secure_url;
    }
    return { imageUrl, videoUrl };
  } catch (uploadErr) {
    logger.error(`[CLOUDINARY] Upload error: ${uploadErr.message}`);
    cleanUpFiles();
    throw new AppError("Erreur lors du téléversement des fichiers sur le Cloud.", 500);
  } finally {
    cleanUpFiles();
  }
};

/**
 * Supprime un média Cloudinary (image ou vidéo).
 */
const deleteSingleMedia = async (url, resourceType = 'image') => {
  if (!url) return;
  const publicId = extractPublicId(url);
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      logger.info(`[CLOUDINARY] Média supprimé : ${publicId} (${resourceType})`);
    } catch (cloudErr) {
      logger.error(`[CLOUDINARY] Echec de suppression du média ${publicId} : ${cloudErr.message}`);
    }
  }
};

module.exports = {
  extractPublicId,
  broadcastBannersUpdate,
  uploadBannerFiles,
  deleteSingleMedia
};
