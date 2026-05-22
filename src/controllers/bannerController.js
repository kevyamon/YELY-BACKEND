// src/controllers/bannerController.js
// CONTROLLER BANNIÈRES - Gestion du Carrousel Marketplace
// STANDARD: Industriel (Validation strict & Nettoyage ressources)

const BannerSlide = require('../models/BannerSlide');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

/**
 * Extrait le public_id Cloudinary depuis une URL sécurisée pour le nettoyage des ressources.
 */
const extractPublicId = (url) => {
  if (!url || !url.includes('/upload/')) return null;
  try {
    const parts = url.split('/upload/');
    let publicIdWithFormat = parts[1];
    
    // Enlever la version (ex: v12345678/)
    if (publicIdWithFormat.startsWith('v')) {
      const slashIndex = publicIdWithFormat.indexOf('/');
      if (slashIndex !== -1) {
        publicIdWithFormat = publicIdWithFormat.substring(slashIndex + 1);
      }
    }
    
    // Enlever l'extension (.jpg, .png, etc.)
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
 * @desc    Récupérer les bannières actives pour le carrousel utilisateur
 * @route   GET /api/v1/banners
 * @access  Public
 */
exports.getActiveBanners = async (req, res, next) => {
  try {
    const banners = await BannerSlide.find({ isActive: true }).sort('order createdAt');
    
    res.status(200).json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Récupérer toutes les bannières pour l'administration
 * @route   GET /api/v1/banners/admin
 * @access  SuperAdmin
 */
exports.getAllBannersAdmin = async (req, res, next) => {
  try {
    const banners = await BannerSlide.find().sort('order createdAt');
    
    res.status(200).json({
      success: true,
      count: banners.length,
      data: banners
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Créer une nouvelle diapositive de bannière
 * @route   POST /api/v1/banners
 * @access  SuperAdmin
 */
exports.createBanner = async (req, res, next) => {
  try {
    const cleanUpFiles = () => {
      if (req.files) {
        if (req.files.image && req.files.image[0]) {
          const path = req.files.image[0].path;
          if (fs.existsSync(path)) fs.unlinkSync(path);
        }
        if (req.files.video && req.files.video[0]) {
          const path = req.files.video[0].path;
          if (fs.existsSync(path)) fs.unlinkSync(path);
        }
      }
    };

    let imageUrl = null;
    let videoUrl = null;

    try {
      if (req.files && req.files.image && req.files.image[0]) {
        const file = req.files.image[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/banners',
          resource_type: 'image'
        });
        imageUrl = result.secure_url;
      }

      if (req.files && req.files.video && req.files.video[0]) {
        const file = req.files.video[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/banners',
          resource_type: 'video'
        });
        videoUrl = result.secure_url;
      }
    } catch (uploadErr) {
      logger.error(`[CLOUDINARY] Upload error: ${uploadErr.message}`);
      cleanUpFiles();
      return next(new AppError("Erreur lors du téléversement des fichiers sur le Cloud.", 500));
    } finally {
      cleanUpFiles();
    }

    const { 
      title, 
      body, 
      badge, 
      animationType, 
      order, 
      isActive,
      layoutType,
      mediaType,
      displayDuration,
      ctaType,
      ctaUrl,
      ctaRoute,
      ctaRouteParams,
      ctaLabel
    } = req.body;

    // Validation de cohérence média
    const parsedMediaType = mediaType || 'image';
    if (parsedMediaType === 'image' && !imageUrl) {
      return next(new AppError("L'image de la bannière est obligatoire pour le format image.", 400));
    }
    if (parsedMediaType === 'video' && !videoUrl) {
      return next(new AppError("La vidéo de la bannière est obligatoire pour le format vidéo.", 400));
    }

    const banner = await BannerSlide.create({
      title,
      body,
      badge: badge || 'NOUVEAU',
      animationType: animationType || 'none',
      image: imageUrl,
      video: videoUrl,
      layoutType: layoutType || 'standard',
      mediaType: parsedMediaType,
      displayDuration: displayDuration ? Number(displayDuration) : null,
      ctaType: ctaType || 'none',
      ctaUrl,
      ctaRoute,
      ctaRouteParams,
      ctaLabel: ctaLabel || 'Voir plus',
      order: order ? Number(order) : 0,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true
    });

    logger.info(`[BANNERS] Nouvelle bannière créée par l'administrateur : ${banner.title || 'Sans titre'}`);
    broadcastBannersUpdate(req);

    res.status(201).json({
      success: true,
      data: banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Modifier une diapositive de bannière
 * @route   PATCH /api/v1/banners/:id
 * @access  SuperAdmin
 */
exports.updateBanner = async (req, res, next) => {
  try {
    let banner = await BannerSlide.findById(req.params.id);
    if (!banner) {
      return next(new AppError("Bannière introuvable.", 404));
    }

    const updateData = { ...req.body };

    const cleanUpFiles = () => {
      if (req.files) {
        if (req.files.image && req.files.image[0]) {
          const path = req.files.image[0].path;
          if (fs.existsSync(path)) fs.unlinkSync(path);
        }
        if (req.files.video && req.files.video[0]) {
          const path = req.files.video[0].path;
          if (fs.existsSync(path)) fs.unlinkSync(path);
        }
      }
    };

    try {
      // Si une nouvelle image est fournie
      if (req.files && req.files.image && req.files.image[0]) {
        const file = req.files.image[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/banners',
          resource_type: 'image'
        });
        
        if (banner.image) {
          const oldPublicId = extractPublicId(banner.image);
          if (oldPublicId) {
            await cloudinary.uploader.destroy(oldPublicId);
            logger.info(`[CLOUDINARY] Ancienne image supprimée : ${oldPublicId}`);
          }
        }

        updateData.image = result.secure_url;
      }

      // Si une nouvelle vidéo est fournie
      if (req.files && req.files.video && req.files.video[0]) {
        const file = req.files.video[0];
        const result = await cloudinary.uploader.upload(file.path, {
          folder: 'yely/banners',
          resource_type: 'video'
        });
        
        if (banner.video) {
          const oldVideoPublicId = extractPublicId(banner.video);
          if (oldVideoPublicId) {
            await cloudinary.uploader.destroy(oldVideoPublicId, { resource_type: 'video' });
            logger.info(`[CLOUDINARY] Ancienne vidéo supprimée : ${oldVideoPublicId}`);
          }
        }

        updateData.video = result.secure_url;
      }
    } catch (uploadErr) {
      logger.error(`[CLOUDINARY] Update upload error: ${uploadErr.message}`);
      cleanUpFiles();
      return next(new AppError("Erreur lors du téléversement de la nouvelle ressource.", 500));
    } finally {
      cleanUpFiles();
    }

    // Gestion correcte des types primitifs
    if (updateData.order !== undefined) updateData.order = Number(updateData.order);
    if (updateData.isActive !== undefined) {
      updateData.isActive = updateData.isActive === 'true' || updateData.isActive === true;
    }
    if (updateData.displayDuration !== undefined) {
      updateData.displayDuration = updateData.displayDuration ? Number(updateData.displayDuration) : null;
    }

    banner = await BannerSlide.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    logger.info(`[BANNERS] Diapositive mise à jour par l'administrateur : ${banner.title || 'Sans titre'}`);
    broadcastBannersUpdate(req);

    res.status(200).json({
      success: true,
      data: banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Activer/Désactiver instantanément une diapositive
 * @route   PATCH /api/v1/banners/:id/toggle
 * @access  SuperAdmin
 */
exports.toggleBannerStatus = async (req, res, next) => {
  try {
    const banner = await BannerSlide.findById(req.params.id);
    if (!banner) {
      return next(new AppError("Bannière introuvable.", 404));
    }

    banner.isActive = !banner.isActive;
    await banner.save();

    logger.info(`[BANNERS] Statut de la diapositive ${banner.title || 'Sans titre'} changé pour : ${banner.isActive}`);
    broadcastBannersUpdate(req);

    res.status(200).json({
      success: true,
      data: banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Supprimer une diapositive de bannière
 * @route   DELETE /api/v1/banners/:id
 * @access  SuperAdmin
 */
exports.deleteBanner = async (req, res, next) => {
  try {
    const banner = await BannerSlide.findById(req.params.id);
    if (!banner) {
      return next(new AppError("Bannière introuvable.", 404));
    }

    // 1. Supprimer l'image associée de Cloudinary
    if (banner.image) {
      const publicId = extractPublicId(banner.image);
      if (publicId) {
        try {
          await cloudinary.uploader.destroy(publicId);
          logger.info(`[CLOUDINARY] Image de la diapositive supprimée : ${publicId}`);
        } catch (cloudErr) {
          logger.error(`[CLOUDINARY] Echec de suppression de l'image ${publicId} : ${cloudErr.message}`);
        }
      }
    }

    // 2. Supprimer la vidéo associée de Cloudinary
    if (banner.video) {
      const videoPublicId = extractPublicId(banner.video);
      if (videoPublicId) {
        try {
          await cloudinary.uploader.destroy(videoPublicId, { resource_type: 'video' });
          logger.info(`[CLOUDINARY] Vidéo de la diapositive supprimée : ${videoPublicId}`);
        } catch (cloudErr) {
          logger.error(`[CLOUDINARY] Echec de suppression de la vidéo ${videoPublicId} : ${cloudErr.message}`);
        }
      }
    }

    // 3. Supprimer la diapositive de la base de données
    await BannerSlide.findByIdAndDelete(req.params.id);

    logger.info(`[BANNERS] Diapositive supprimée de l'administration : ${banner.title || 'Sans titre'}`);
    broadcastBannersUpdate(req);

    res.status(200).json({
      success: true,
      message: "La diapositive a été supprimée avec succès."
    });
  } catch (error) {
    next(error);
  }
};
