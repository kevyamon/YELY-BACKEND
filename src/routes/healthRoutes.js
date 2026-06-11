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

router.get('/debug-drivers', async (req, res) => {
  try {
    const User = require('../models/User');
    const Order = require('../models/Order');
    const redis = require('../config/redis');

    const drivers = await User.find({ role: 'driver' }).lean();
    const orders = await Order.find({})
      .sort('-createdAt')
      .limit(5)
      .populate('seller customer')
      .lean();

    let redisDriverIds = [];
    try {
      redisDriverIds = await redis.zrange('active_drivers', 0, -1);
    } catch (err) {
      redisDriverIds = ['Redis error: ' + err.message];
    }

    const response = {
      redisDrivers: redisDriverIds,
      drivers: drivers.map(d => ({
        id: d._id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        isAvailable: d.isAvailable,
        isBanned: d.isBanned,
        isDeleted: d.isDeleted,
        currentLocation: d.currentLocation,
        deliveryPreferences: d.deliveryPreferences,
        ledger: d.ledger,
        createdAt: d.createdAt
      })),
      orders: orders.map(o => ({
        id: o._id,
        status: o.status,
        seller: o.seller ? {
          id: o.seller._id,
          name: o.seller.name,
          address: o.seller.address,
          currentLocation: o.seller.currentLocation
        } : null,
        customer: o.customer ? {
          name: o.customer.name
        } : null,
        createdAt: o.createdAt
      }))
    };

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

module.exports = router;