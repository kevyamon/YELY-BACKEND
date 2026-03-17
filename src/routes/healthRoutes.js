// src/routes/healthRoutes.js
// ROUTES HEALTH & VERSION - Audit-ready + constantes centralisees
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const CONSTANTS = require('../utils/constants');
const logger = require('../config/logger');
const { env } = require('../config/env');
const Settings = require('../models/Settings');

router.get('/', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: env.NODE_ENV,
    version: '1.0.0', 
    service: 'Yely Backend',
    requestId: req.id || `req-${Date.now()}`
  };

  logger.info(`[HEALTH CHECK] ${healthData.requestId} - OK`);
  res.status(CONSTANTS.HTTP_STATUS.OK).json(healthData);
});

router.get('/version', (req, res) => {
  res.status(CONSTANTS.HTTP_STATUS.OK).json({
    version: '1.0.0',
    commit: process.env.GIT_COMMIT || 'unknown',
    buildDate: process.env.BUILD_DATE || new Date().toISOString()
  });
});

// NOUVELLE ROUTE PUBLIQUE : Demarrage de l'Application Mobile / PWA
router.get('/config', async (req, res) => {
  try {
    let settings = await Settings.findOne().lean();
    if (!settings) {
      settings = {
        latestVersion: '1.0.0',
        mandatoryUpdate: false,
        updateUrl: 'https://download-yely.onrender.com',
        isOta: false,
        isGlobalFreeAccess: false,
        promoMessage: ''
      };
    }
    
    // On ne renvoie QUE les informations publiques et non sensibles
    res.status(CONSTANTS.HTTP_STATUS.OK).json({
      latestVersion: settings.latestVersion || '1.0.0',
      mandatoryUpdate: !!settings.mandatoryUpdate,
      updateUrl: settings.updateUrl || 'https://download-yely.onrender.com',
      isOta: !!settings.isOta,
      isGlobalFreeAccess: !!settings.isGlobalFreeAccess,
      promoMessage: settings.promoMessage || ''
    });
  } catch (error) {
    logger.error(`[HEALTH CONFIG] Erreur de lecture : ${error.message}`);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});

module.exports = router;