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
    // Une image est requise à la création
    if (!req.file) {
      return next(new AppError("L'image de la bannière est obligatoire.", 400));
    }

    // Téléversement sur Cloudinary
    let result;
    try {
      result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'yely/banners',
        resource_type: 'image'
      });
    } catch (uploadErr) {
      logger.error(`[CLOUDINARY] Upload error: ${uploadErr.message}`);
      return next(new AppError("Erreur lors du téléversement de l'image sur le Cloud.", 500));
    } finally {
      // Toujours nettoyer le fichier temporaire local
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    const { title, body, badge, animationType, order, isActive } = req.body;

    const banner = await BannerSlide.create({
      title,
      body,
      badge: badge || 'NOUVEAU',
      animationType: animationType || 'none',
      image: result.secure_url,
      order: order ? Number(order) : 0,
      isActive: isActive !== undefined ? isActive === 'true' || isActive === true : true
    });

    logger.info(`[BANNERS] Nouvelle bannière créée par l'administrateur : ${banner.title}`);
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

    // Si une nouvelle image est fournie
    if (req.file) {
      let result;
      try {
        // 1. Upload la nouvelle image
        result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'yely/banners',
          resource_type: 'image'
        });
        
        // 2. Supprime l'ancienne image pour éviter l'encombrement
        const oldPublicId = extractPublicId(banner.image);
        if (oldPublicId) {
          await cloudinary.uploader.destroy(oldPublicId);
          logger.info(`[CLOUDINARY] Ancienne image supprimée : ${oldPublicId}`);
        }

        updateData.image = result.secure_url;
      } catch (uploadErr) {
        logger.error(`[CLOUDINARY] Update upload error: ${uploadErr.message}`);
        return next(new AppError("Erreur lors du téléversement de la nouvelle image.", 500));
      } finally {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
    }

    // Gestion correcte des types primitifs
    if (updateData.order !== undefined) updateData.order = Number(updateData.order);
    if (updateData.isActive !== undefined) {
      updateData.isActive = updateData.isActive === 'true' || updateData.isActive === true;
    }

    banner = await BannerSlide.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    });

    logger.info(`[BANNERS] Diapositive mise à jour par l'administrateur : ${banner.title}`);
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

    logger.info(`[BANNERS] Statut de la diapositive ${banner.title} changé pour : ${banner.isActive}`);
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
    const publicId = extractPublicId(banner.image);
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
        logger.info(`[CLOUDINARY] Image de la diapositive supprimée : ${publicId}`);
      } catch (cloudErr) {
        logger.error(`[CLOUDINARY] Echec de suppression de l'image ${publicId} : ${cloudErr.message}`);
      }
    }

    // 2. Supprimer la diapositive de la base de données
    await BannerSlide.findByIdAndDelete(req.params.id);

    logger.info(`[BANNERS] Diapositive supprimée de l'administration : ${banner.title}`);
    broadcastBannersUpdate(req);

    res.status(200).json({
      success: true,
      message: "La diapositive a été supprimée avec succès."
    });
  } catch (error) {
    next(error);
  }
};
