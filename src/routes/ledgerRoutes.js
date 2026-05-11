// src/routes/ledgerRoutes.js
// ROUTES LEDGER - Réconciliation Cash

const express = require('express');
const ledgerController = require('../controllers/ledgerController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

// Consulter son ardoise (Livreur ou Vendeur)
router.get('/', authorize('driver', 'seller', 'admin'), ledgerController.getMyLedger);

// Statistiques pour le dashboard vendeur
router.get('/stats', authorize('seller', 'admin'), ledgerController.getLedgerStats);

// Action de régularisation (Vendeur uniquement)
router.patch('/:id/clear', authorize('seller', 'admin'), ledgerController.clearLedgerEntry);

module.exports = router;
