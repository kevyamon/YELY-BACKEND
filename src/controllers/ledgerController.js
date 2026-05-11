// src/controllers/ledgerController.js
// CONTROLLER LEDGER - Réconciliation Financière & Sécurité Cash
// STANDARD: Audit Grade (Traçabilité des Flux)

const Ledger = require('../models/Ledger');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

/**
 * @desc    Récupérer l'ardoise (dettes actives) de l'utilisateur connecté
 * @route   GET /api/v1/ledger
 * @access  Private (Driver/Seller)
 */
exports.getMyLedger = async (req, res, next) => {
  try {
    let query = { status: 'pending' };
    
    if (req.user.role === 'driver') {
      query.driver = req.user._id;
    } else if (req.user.role === 'seller') {
      query.seller = req.user._id;
    } else if (req.user.role !== 'admin') {
      return next(new AppError('Non autorisé', 403));
    }

    const entries = await Ledger.find(query)
      .populate('driver', 'name phone')
      .populate('seller', 'name phone')
      .populate('order', 'totalPrice itemsPrice')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: entries.length,
      data: entries
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Confirmer la réception physique du paiement (Effacer la dette)
 * @route   PATCH /api/v1/ledger/:id/clear
 * @access  Private (Seller Only)
 */
exports.clearLedgerEntry = async (req, res, next) => {
  try {
    const ledger = await Ledger.findById(req.params.id);

    if (!ledger) {
      return next(new AppError('Entrée introuvable', 404));
    }

    // Seul le vendeur concerné peut valider la réception du cash
    if (ledger.seller.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('Vous n\'êtes pas autorisé à valider ce paiement', 403));
    }

    if (ledger.status === 'cleared') {
      return next(new AppError('Ce paiement a déjà été régularisé', 400));
    }

    // 1. Marquer l'entrée comme régularisée
    ledger.status = 'cleared';
    ledger.clearedAt = Date.now();
    await ledger.save();

    // 2. Déduire le montant de la dette cumulée du livreur
    const driver = await User.findById(ledger.driver);
    if (driver) {
      driver.ledger.currentCashDebt = Math.max(0, driver.ledger.currentCashDebt - ledger.amount);
      
      // 3. Déblocage automatique si la dette repasse sous la limite
      if (driver.ledger.currentCashDebt < driver.ledger.maxCashDebt) {
        driver.ledger.isBlocked = false;
        logger.info(`[LEDGER] Driver ${driver.email} débloqué suite à régularisation.`);
      }
      
      await driver.save();
    }

    res.status(200).json({
      success: true,
      message: 'Paiement régularisé avec succès',
      data: ledger
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Récupérer les statistiques globales de l'ardoise (Pour Dashboard)
 */
exports.getLedgerStats = async (req, res, next) => {
  try {
    const stats = await Ledger.aggregate([
      { $match: { seller: req.user._id, status: 'pending' } },
      { $group: { _id: null, totalPending: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);

    res.status(200).json({
      success: true,
      data: stats[0] || { totalPending: 0, count: 0 }
    });
  } catch (error) {
    next(error);
  }
};
