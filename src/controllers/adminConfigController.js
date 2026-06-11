// src/controllers/adminConfigController.js
// SOUS-CONTROLEUR ADMIN - Paramètres globaux, promos, versions et statistiques
// STANDARD: Industriel / Bank Grade

const adminConfigService = require('../services/adminConfigService');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const logger = require('../config/logger');

const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminConfigService.getDashboardStats();
    return successResponse(res, stats, "Statistiques recuperees.");
  } catch (error) {
    logger.error(`[ADMIN STATS] Erreur: ${error.message}`);
    return errorResponse(res, "Impossible de recuperer les statistiques.", 500);
  }
};

const getFinanceData = async (req, res) => {
  try {
    const data = await adminConfigService.getFinanceData(req.query.period);
    return successResponse(res, data, "Donnees financieres recuperees.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const togglePromo = async (req, res) => {
  try {
    const result = await adminConfigService.togglePromo(req.body.isActive, req.user._id);
    try {
      const io = req.app.get('socketio');
      if (io) io.emit('promo_updated', { isPromoActive: result.isPromoActive });
    } catch (socketError) { logger.error(`[SOCKET PROMO] Echec: ${socketError.message}`); }

    return successResponse(res, result, "Statut promo mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const updateWaveLinks = async (req, res) => {
  try {
    const { weeklyLink, monthlyLink } = req.body;
    const result = await adminConfigService.updateWaveLinks(weeklyLink, monthlyLink, req.user._id);
    return successResponse(res, result, "Liens Wave mis a jour.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const toggleLoadReduce = async (req, res) => {
  try {
    const io = req.app.get('socketio');
    const result = await adminConfigService.toggleLoadReduce(req.user._id, req.user.email, io);
    return successResponse(res, result, result.isLoadReduced ? "Mode Reduction de charge active." : "Mode Reduction de charge desactive.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const toggleGlobalFreeAccess = async (req, res) => {
  try {
    const { isGlobalFreeAccess, promoMessage } = req.body;
    const io = req.app.get('socketio');
    const result = await adminConfigService.toggleGlobalFreeAccess(isGlobalFreeAccess, promoMessage, req.user._id, req.user.email, io);
    return successResponse(res, result, `Mode VIP ${result.isGlobalFreeAccess ? 'activé' : 'désactivé'} avec succès.`);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const updateAppVersion = async (req, res) => {
  try {
    const io = req.app.get('socketio');
    const settings = await adminConfigService.updateAppVersion(req.body, req.user._id, req.user.email, io);
    return successResponse(res, {
      latestVersion: settings.latestVersion,
      mandatoryUpdate: settings.mandatoryUpdate,
      updateUrl: settings.updateUrl,
      isOta: settings.isOta 
    }, "Parametres de version mis a jour et diffuses avec succes.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getSystemConfig = async (req, res) => {
  try {
    const settings = await adminConfigService.getSystemConfig();
    return successResponse(res, settings, "Configuration systeme recuperee.");
  } catch (error) {
    return errorResponse(res, "Impossible de recuperer la configuration systeme.", 500);
  }
};

module.exports = {
  getDashboardStats,
  getFinanceData,
  togglePromo,
  updateWaveLinks,
  toggleLoadReduce,
  toggleGlobalFreeAccess,
  updateAppVersion,
  getSystemConfig
};
