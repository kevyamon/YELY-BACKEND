// src/routes/configRoutes.js
// ROUTE PUBLIQUE REMOTE CONFIG, VERSIONING & ETAT DE MAINTENANCE
// STANDARD: Industriel / Bank Grade / Self-Healing (Sans Emojis)

const express = require('express');
const router = express.Router();
const CONSTANTS = require('../utils/constants');
const logger = require('../config/logger');
const Settings = require('../models/Settings');

/**
 * @route   GET /api/v1/config
 * @desc    Renvoie la configuration publique de l'application (Remote Config / Play Store / Maintenance)
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

    // Double controle : Variable d'environnement Render OU Configuration MongoDB
    const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true' || Boolean(settings?.isMaintenanceMode);
    const maintenanceMessage = process.env.MAINTENANCE_MESSAGE || settings?.maintenanceMessage || "Maintenance technique en cours. Nos equipes interviennent pour optimiser votre experience. Retour tres rapide !";

    const latestVersionCode = parseInt(
      process.env.LATEST_VERSION_CODE || (settings?.latestVersionCode ? String(settings.latestVersionCode) : '22'),
      10
    );

    const minVersionCode = parseInt(
      process.env.MIN_VERSION_CODE || (settings?.minVersionCode ? String(settings.minVersionCode) : '22'),
      10
    );

    const forceUpdate = process.env.FORCE_UPDATE !== undefined
      ? process.env.FORCE_UPDATE === 'true'
      : Boolean(settings?.mandatoryUpdate);

    const updateTitle = process.env.UPDATE_TITLE || 'Mise a jour disponible';
    const updateMessage = process.env.UPDATE_MESSAGE || 'Une nouvelle version de Yely est disponible sur le Play Store avec des ameliorations importantes.';
    const storeUrl = process.env.STORE_URL || settings?.updateUrl || 'https://play.google.com/store/apps/details?id=com.yely.app';

    return res.status(CONSTANTS.HTTP_STATUS.OK).json({
      status: 'success',
      data: {
        maintenance: {
          isMaintenanceMode,
          message: maintenanceMessage,
          allowedRoles: settings?.maintenanceAllowedRoles || ['superadmin', 'admin']
        },
        versioning: {
          latestVersionCode,
          minVersionCode,
          forceUpdate,
          updateTitle,
          updateMessage,
          storeUrl,
          latestVersion: settings?.latestVersion || process.env.LATEST_VERSION || '1.7.0',
          isOta: Boolean(settings?.isOta)
        },
        isGlobalFreeAccess: Boolean(settings?.isGlobalFreeAccess),
        promoMessage: settings?.promoMessage || ''
      }
    });
  } catch (error) {
    logger.error(`[CONFIG ROUTE] Erreur lors de la recuperation de la configuration: ${error.message}`);
    
    // Fallback de secours ultime en cas d'erreur critique serveur
    return res.status(200).json({
      status: 'success',
      data: {
        maintenance: {
          isMaintenanceMode: process.env.MAINTENANCE_MODE === 'true',
          message: "Service temporairement en cours de maintenance.",
          allowedRoles: ['superadmin', 'admin']
        },
        versioning: {
          latestVersionCode: 22,
          minVersionCode: 22,
          forceUpdate: false,
          storeUrl: 'https://play.google.com/store/apps/details?id=com.yely.app',
          latestVersion: '1.7.0',
          isOta: false
        },
        isGlobalFreeAccess: false,
        promoMessage: ''
      }
    });
  }
});

module.exports = router;
