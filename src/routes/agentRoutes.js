// src/routes/agentRoutes.js
const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { protectAgent } = require('../middleware/agentAuthMiddleware');

// Routes Publiques
router.post('/register', agentController.registerAgent);
router.post('/login', agentController.loginAgent);
router.get('/leaderboard', agentController.getLeaderboard);

// ROUTES CEO SECRÈTES
router.get('/darkyelydb42', agentController.getAdminDashboard);
router.post('/darkyelydb42/payout/:agentId', agentController.payoutAgent);
router.post('/darkyelydb42/payout-all', agentController.payoutAllAgents);

// Routes Securisees
router.use(protectAgent);
router.get('/dashboard', agentController.getDashboard);
router.post('/claim', agentController.claimClient);

module.exports = router;