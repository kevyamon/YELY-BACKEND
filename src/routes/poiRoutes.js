// src/routes/poiRoutes.js [MODIFIÉ]
// ROUTES DES LIEUX - Portes d'entrée de l'API
// CSCSM Level: Bank Grade

const express = require('express');
const poiController = require('../controllers/poiController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// --------------------------------------------------------------------------
// ROUTES PUBLIQUES (Ouvertes à l'application mobile pour lire la carte)
// --------------------------------------------------------------------------
router.get('/', poiController.getAllPOIs);

// --------------------------------------------------------------------------
// ROUTES SECURISEES UTILISATEURS (Riders, Drivers, Sellers)
// --------------------------------------------------------------------------
router.get('/search', authMiddleware.protect, poiController.searchPOIs);
router.post('/resolve-external', authMiddleware.protect, poiController.resolveExternalPOI);
router.post('/suggest', authMiddleware.protect, poiController.suggestPOI);

// --------------------------------------------------------------------------
// ROUTES SÉCURISÉES SUPERADMIN (Dashboard de gestion)
// --------------------------------------------------------------------------
router.use(authMiddleware.protect);
router.use(authMiddleware.authorize('superadmin'));

router.get('/admin', poiController.getAdminPOIs);
router.post('/auto-import', poiController.autoImportPOIs);
router.post('/', poiController.createPOI);
router.post('/bulk-import', poiController.bulkImportPOIs);
router.put('/:id', poiController.updatePOI);
router.delete('/:id', poiController.deletePOI);

module.exports = router;