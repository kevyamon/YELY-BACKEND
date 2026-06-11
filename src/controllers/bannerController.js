// src/controllers/bannerController.js
// CONTROLLER BANNIÈRES - Gestion du Carrousel Marketplace
// STANDARD: Industriel / Bank Grade

const BannerSlide = require('../models/BannerSlide');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const { 
  broadcastBannersUpdate, 
  uploadBannerFiles, 
  deleteSingleMedia 
} = require('../utils/bannerHelpers');

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
    const { imageUrl, videoUrl } = await uploadBannerFiles(req.files);

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

    const { imageUrl, videoUrl } = await uploadBannerFiles(req.files);

    if (imageUrl) {
      if (banner.image) await deleteSingleMedia(banner.image, 'image');
      updateData.image = imageUrl;
    }

    if (videoUrl) {
      if (banner.video) await deleteSingleMedia(banner.video, 'video');
      updateData.video = videoUrl;
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

    if (banner.image) await deleteSingleMedia(banner.image, 'image');
    if (banner.video) await deleteSingleMedia(banner.video, 'video');

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
