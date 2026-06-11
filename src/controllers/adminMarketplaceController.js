// src/controllers/adminMarketplaceController.js
// SOUS-CONTROLEUR ADMIN - Commandes marketplace, ardoises ledgers et trajets
// STANDARD: Industriel / Bank Grade

const adminMarketplaceService = require('../services/adminMarketplaceService');
const adminService = require('../services/adminService');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const getMarketplaceStats = async (req, res) => {
  try {
    const stats = await adminMarketplaceService.getMarketplaceStats();
    return successResponse(res, stats, "Statistiques Marketplace récupérées.");
  } catch (error) {
    return errorResponse(res, "Erreur statistiques marketplace.", 500);
  }
};

const getMarketplaceOrders = async (req, res) => {
  try {
    const result = await adminMarketplaceService.getMarketplaceOrders(req.query);
    return successResponse(res, result, "Commandes récupérées.");
  } catch (error) {
    return errorResponse(res, "Erreur récupération commandes.", 500);
  }
};

const overrideMarketplaceOrder = async (req, res) => {
  try {
    const io = req.app.get('socketio');
    const order = await adminMarketplaceService.overrideMarketplaceOrder(req.params.id, req.body, req.user._id, req.user.name, io);
    return successResponse(res, order, "Commande écrasée et mise à jour avec succès.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getMarketplaceLedgers = async (req, res) => {
  try {
    const result = await adminMarketplaceService.getMarketplaceLedgers(req.query);
    return successResponse(res, result, "Ardoises financières récupérées.");
  } catch (error) {
    return errorResponse(res, "Erreur récupération ardoises.", 500);
  }
};

const forceClearLedger = async (req, res) => {
  try {
    const io = req.app.get('socketio');
    const ledger = await adminMarketplaceService.forceClearLedger(req.params.id, req.body.reason, req.user._id, req.user.name, io);
    return successResponse(res, ledger, "L'ardoise a été réconciliée de force avec succès.");
  } catch (error) {
    return errorResponse(res, error.message || "Erreur réconciliation ardoise.", 500);
  }
};

const getAllRides = async (req, res) => {
  try {
    const result = await adminService.getAllRidesHistory(req.query);
    return successResponse(res, result, "Historique des courses recupere avec succes.");
  } catch (error) {
    return errorResponse(res, "Impossible de recuperer l'historique des courses.", 500);
  }
};

const toggleRideArchive = async (req, res) => {
  try {
    const ride = await adminService.toggleRideArchive(req.params.id, req.user._id);
    return successResponse(res, { isArchived: ride.isArchivedByAdmin }, ride.isArchivedByAdmin ? "Course archivee." : "Course desarchivee.");
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = {
  getMarketplaceStats,
  getMarketplaceOrders,
  overrideMarketplaceOrder,
  getMarketplaceLedgers,
  forceClearLedger,
  getAllRides,
  toggleRideArchive
};
