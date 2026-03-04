// src/routes/poiRoutes.js [NOUVEAU]
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
// ROUTES SÉCURISÉES (Réservées uniquement au SuperAdmin depuis le Dashboard)
// --------------------------------------------------------------------------
// On active la vérification du token et on restreint au rôle "superadmin"
router.use(authMiddleware.protect);
router.use(authMiddleware.restrictTo('superadmin'));

router.post('/', poiController.createPOI);
router.post('/bulk-import', poiController.bulkImportPOIs); // Route spéciale pour l'ajout en masse
router.put('/:id', poiController.updatePOI);
router.delete('/:id', poiController.deletePOI);

module.exports = router;