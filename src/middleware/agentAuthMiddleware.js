// src/middleware/agentAuthMiddleware.js
// PROTECTION AGENTS - Isolation des sessions
// CSCSM Level: Bank Grade

const jwt = require('jsonwebtoken');
const Agent = require('../models/Agent');
const AppError = require('../utils/AppError');
const { env } = require('../config/env');
const { cleanTokenString } = require('../utils/tokenService');

const protectAgent = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new AppError('Non autorise, session manquante.', 401);
    }

    const cleanToken = cleanTokenString(token);
    const decoded = jwt.verify(cleanToken, env.JWT_SECRET);

    const agent = await Agent.findById(decoded.userId).lean();
    if (!agent || !agent.isActive) {
      throw new AppError('Compte agent inactif ou introuvable.', 401);
    }

    req.agent = agent;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Votre session a expire.', 401));
    }
    next(new AppError('Non autorise, token invalide.', 401));
  }
};

module.exports = { protectAgent };