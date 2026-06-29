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

// ROUTE DE DIAGNOSTIC CHAUFFEURS TEMPORAIRE
router.get('/debug-drivers', async (req, res) => {
  try {
    const User = require('../models/User');
    const Order = require('../models/Order');
    const redis = require('../config/redis');
    
    // Récupération de tous les chauffeurs
    const drivers = await User.find({ role: 'driver' }).lean();
    
    // Récupération des 5 dernières commandes pour analyser les coordonnées du vendeur
    const orders = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('seller customer')
      .lean();
      
    // Récupération des identifiants dans le registre Redis active_drivers
    let redisDriverIds = [];
    try {
      redisDriverIds = await redis.zrange('active_drivers', 0, -1);
    } catch (redisErr) {
      redisDriverIds = [`Erreur Redis : ${redisErr.message}`];
    }
    
    res.status(200).json({
      success: true,
      redisDrivers: redisDriverIds,
      drivers: drivers.map(d => ({
        id: d._id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        isAvailable: d.isAvailable,
        isBanned: d.isBanned,
        isDeleted: d.isDeleted,
        verificationStatus: d.verificationStatus,
        subscription: d.subscription,
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
    });
  } catch (error) {
    logger.error(`[HEALTH DEBUG DRIVERS] Erreur : ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ROUTE DE DIAGNOSTIC DE RECHERCHE DE CHAUFFEURS
router.get('/debug-find', async (req, res) => {
  try {
    const userRepository = require('../repositories/userRepository');
    const Settings = require('../models/Settings');
    const User = require('../models/User');

    const origin = [-3.028218001127243, 5.415814471996204]; // Position vendeur
    const radius = 1000;
    const forfait = 'STANDARD';
    const missionType = 'DELIVERY';

    const drivers = await userRepository.findAvailableDriversNear(
      origin,
      radius,
      forfait,
      [],
      missionType,
      1
    );

    const settings = await Settings.findOne();
    const isGlobalFreeAccess = settings?.isGlobalFreeAccess || false;

    const baseQuery = {
      role: 'driver',
      isAvailable: true,
      isBanned: false
    };

    const results = {};

    results.allAvailableDrivers = await User.find(baseQuery).select('name verificationStatus subscription deliveryPreferences ledger').lean();
    results.approvedOnly = await User.find({ ...baseQuery, verificationStatus: 'approved' }).select('name').lean();
    results.withSub = !isGlobalFreeAccess 
      ? await User.find({ ...baseQuery, 'subscription.isActive': true }).select('name').lean()
      : 'skip';
    results.withDeliveryPref = await User.find({ ...baseQuery, 'deliveryPreferences.isDeliveryActive': { $ne: false } }).select('name').lean();
    results.withLedgerBlocked = await User.find({ ...baseQuery, 'ledger.isBlocked': { $ne: true } }).select('name').lean();

    results.geoSearch = await User.find({
      ...baseQuery,
      currentLocation: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: origin },
          $maxDistance: radius
        }
      }
    }).select('name').lean();

    res.status(200).json({
      success: true,
      settings: { isGlobalFreeAccess },
      finalFindDrivers: drivers.map(d => d.name),
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});

// ROUTE DE DIAGNOSTIC D'ESTIMATION DE TARIFS
router.get('/debug-estimate', async (req, res) => {
  try {
    const pickupLat = req.query.pickupLat || '5.4215';
    const pickupLng = req.query.pickupLng || '-3.0285';
    const dropoffLat = req.query.dropoffLat || '5.4028';
    const dropoffLng = req.query.dropoffLng || '-3.0222';

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];

    const rideService = require('../services/ride/rideLifecycleService');
    const pricingService = require('../services/pricingService');

    const distance = await rideService.getRouteDistance(origin, destination);
    const pricingResult = await pricingService.generatePriceOptions(
      origin,
      destination,
      distance,
      1,
      false,
      'sunny'
    );

    res.status(200).json({
      success: true,
      pickup: { lat: pickupLat, lng: pickupLng },
      dropoff: { lat: dropoffLat, lng: dropoffLng },
      origin,
      destination,
      distance,
      pricingResult
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;