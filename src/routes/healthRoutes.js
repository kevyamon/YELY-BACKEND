// src/routes/healthRoutes.js
// ROUTES HEALTH & VERSION - Audit-ready + constantes centralisées
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const CONSTANTS = require('../utils/constants');
const logger = require('../config/logger');
const { env } = require('../config/env');

router.get('/', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: env.NODE_ENV,
    version: '1.0.0', // On mettra le hash Git en Phase 12
    service: 'Yély Backend',
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

module.exports = router;