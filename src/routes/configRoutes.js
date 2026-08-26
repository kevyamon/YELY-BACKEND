// src/routes/configRoutes.js
// ROUTE PUBLIQUE REMOTE CONFIG & VERSIONING PLAY STORE
// STANDARD: Industriel / Bank Grade

const express = require('express');
const router = express.Router();
const CONSTANTS = require('../utils/constants');
const logger = require('../config/logger');
const Settings = require('../models/Settings');

/**
 * @route   GET /api/v1/config
 * @desc    Renvoie la configuration publique de l'application (Remote Config / Play Store / VIP)
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    let settings = null;
    try {
      settings = await Settings.findOne().lean();
    } catch (dbErr) {
      logger.warn(`[CONFIG ROUTE] Avertissement lecture DB Settings: ${dbErr.message}`);
    }

    const latestVersionCode = parseInt(
      process.env.LATEST_VERSION_CODE || (settings?.latestVersionCode ? String(settings.latestVersionCode) : '19'),
      10
    );

    const minVersionCode = parseInt(
      process.env.MIN_VERSION_CODE || (settings?.minVersionCode ? String(settings.minVersionCode) : '19'),
      10
    );

    const forceUpdate = process.env.FORCE_UPDATE !== undefined
      ? process.env.FORCE_UPDATE === 'true'
      : Boolean(settings?.mandatoryUpdate);

    const updateTitle = process.env.UPDATE_TITLE || 'Mise à jour disponible';
    const updateMessage = process.env.UPDATE_MESSAGE || 'Une nouvelle version de Yély est disponible sur le Play Store avec des améliorations importantes.';
    const storeUrl = process.env.STORE_URL || settings?.updateUrl || 'https://play.google.com/store/apps/details?id=com.yely.app';

    return res.status(CONSTANTS.HTTP_STATUS.OK).json({
      status: 'success',
      data: {
        versioning: {
          latestVersionCode,
          minVersionCode,
          forceUpdate,
          updateTitle,
          updateMessage,
          storeUrl,
          latestVersion: settings?.latestVersion || process.env.LATEST_VERSION || '1.7',
          isOta: Boolean(settings?.isOta)
        },
        isGlobalFreeAccess: Boolean(settings?.isGlobalFreeAccess),
        promoMessage: settings?.promoMessage || ''
      }
    });
  } catch (error) {
    logger.error(`[CONFIG ROUTE] Erreur lors de la récupération de la configuration: ${error.message}`);
    return res.status(CONSTANTS.HTTP_STATUS.INTERNAL_SERVER_ERROR || 500).json({
      status: 'error',
      message: 'Erreur serveur lors de la récupération de la configuration.'
    });
  }
});

module.exports = router;
