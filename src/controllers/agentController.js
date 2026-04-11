// src/controllers/agentController.js
// CONTROLEUR AGENTS - Logique de parrainage et remuneration
// CSCSM Level: Bank Grade

const Agent = require('../models/Agent');
const Claim = require('../models/Claim');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { successResponse } = require('../utils/responseHandler');
const { generateAccessToken } = require('../utils/tokenService');

// Bareme de remuneration
const REWARD_RIDER = 200;
const REWARD_DRIVER = 1000;
const MAX_HOURS_DELAY = 24;

const registerAgent = async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) throw new AppError("Nom et telephone requis.", 400);

    const cleanPhone = phone.replace(/[\s-]/g, '');
    const existing = await Agent.findOne({ phone: cleanPhone });
    if (existing) throw new AppError("Ce numero est deja enregistre comme agent.", 409);

    const agentId = `YELY-${Math.floor(1000 + Math.random() * 9000)}`;
    const agent = await Agent.create({ name, phone: cleanPhone, agentId });

    return successResponse(res, { agentId: agent.agentId }, "Compte agent cree avec succes.", 201);
  } catch (error) {
    next(error);
  }
};

const loginAgent = async (req, res, next) => {
  try {
    const { agentId, phone } = req.body;
    if (!agentId || !phone) throw new AppError("Identifiant et telephone requis.", 400);

    const cleanPhone = phone.replace(/[\s-]/g, '');
    const agent = await Agent.findOne({ agentId: agentId.toUpperCase(), phone: cleanPhone });

    if (!agent) throw new AppError("Identifiants incorrects.", 401);
    if (!agent.isActive) throw new AppError("Ce compte agent est desactive.", 403);

    const accessToken = generateAccessToken(agent._id.toString(), 'agent');

    return successResponse(res, { agent, accessToken }, "Connexion reussie.");
  } catch (error) {
    next(error);
  }
};

const claimClient = async (req, res, next) => {
  try {
    const { clientPhone } = req.body;
    if (!clientPhone) throw new AppError("Numero du client requis.", 400);

    const cleanClientPhone = clientPhone.replace(/[\s-]/g, '');
    
    // 1. Verifier si le client existe
    const client = await User.findOne({ phone: cleanClientPhone });
    if (!client) throw new AppError("Ce numero n'est pas encore inscrit sur Yely. Le client doit terminer son inscription d'abord.", 404);

    // 2. Verifier l'anciennete du compte (Anti-triche)
    const hoursSinceCreation = (Date.now() - client.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCreation > MAX_HOURS_DELAY) {
      throw new AppError("Ce compte a ete cree il y a plus de 24h. Il ne peut plus etre parraine.", 400);
    }

    // 3. Verifier les doublons de parrainage
    const existingClaim = await Claim.findOne({ clientPhone: cleanClientPhone });
    if (existingClaim) throw new AppError("Ce client a deja ete parraine par un autre agent.", 409);

    // 4. Calcul de la prime et validation
    const amount = client.role === 'driver' ? REWARD_DRIVER : REWARD_RIDER;

    await Claim.create({
      agent: req.agent._id,
      clientPhone: cleanClientPhone,
      clientUser: client._id,
      clientRole: client.role,
      amount
    });

    const updatedAgent = await Agent.findByIdAndUpdate(
      req.agent._id,
      { $inc: { totalEarned: amount } },
      { new: true }
    );

    return successResponse(res, { 
      amountAdded: amount, 
      newTotal: updatedAgent.totalEarned 
    }, "Prime validee avec succes !");
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const agent = await Agent.findById(req.agent._id);
    const recentClaims = await Claim.find({ agent: req.agent._id })
      .sort({ createdAt: -1 })
      .limit(10);

    return successResponse(res, { agent, recentClaims }, "Tableau de bord recupere.");
  } catch (error) {
    next(error);
  }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const topAgents = await Agent.find({ isActive: true })
      .sort({ totalEarned: -1 })
      .limit(5)
      .select('name agentId totalEarned');

    return successResponse(res, { leaderboard: topAgents }, "Classement recupere.");
  } catch (error) {
    next(error);
  }
};

const getAdminDashboard = async (req, res, next) => {
  try {
    const masterPassword = req.headers['x-admin-password'];
    if (masterPassword !== (process.env.ADMIN_BACKOFFICE_PWD || 'Mafere2026')) {
      throw new AppError("Acces refuse.", 403);
    }

    const agents = await Agent.find().sort({ totalEarned: -1 });
    const totalDistributed = agents.reduce((sum, agent) => sum + agent.totalEarned, 0);

    return successResponse(res, { agents, totalDistributed }, "Backoffice charge.");
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerAgent,
  loginAgent,
  claimClient,
  getDashboard,
  getLeaderboard,
  getAdminDashboard
};