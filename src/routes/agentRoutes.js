// src/routes/agentRoutes.js
// ROUTES AGENTS - Acces PWA
// CSCSM Level: Bank Grade

const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { protectAgent } = require('../middleware/agentAuthMiddleware');

// Routes Publiques
router.post('/register', agentController.registerAgent);
router.post('/login', agentController.loginAgent);
router.get('/leaderboard', agentController.getLeaderboard);

// ROUTE CEO SECRÈTE (Obscurcie)
router.get('/darkyelydb42', agentController.getAdminDashboard);

// Routes Securisees (Agent connecte)
router.use(protectAgent);
router.get('/dashboard', agentController.getDashboard);
router.post('/claim', agentController.claimClient);

module.exports = router;