// src/controllers/poiController.js [CORRIGÉ]
// CONTRÔLEUR DES LIEUX - Logique métier (Ajout, Lecture, Modification, Suppression)
// CSCSM Level: Bank Grade

const POI = require('../models/POI');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

// 1. Lire tous les lieux actifs (Pour l'application mobile des utilisateurs)
exports.getAllPOIs = async (req, res, next) => {
  try {
    const pois = await POI.find({ isActive: true });
    
    res.status(200).json({
      success: true,
      count: pois.length,
      data: pois,
    });
  } catch (error) {
    logger.error(`Erreur lors de la récupération des lieux: ${error.message}`);
    next(new AppError('Impossible de récupérer les lieux', 500));
  }
};

// 2. Créer un nouveau lieu (Pour le SuperAdmin)
exports.createPOI = async (req, res, next) => {
  try {
    const newPOI = await POI.create(req.body);
    
    // TEMPS RÉEL : On notifie tous les clients connectés
    const io = req.app.get('io');
    if (io) {
      io.emit('poi_updated', { action: 'create', poi: newPOI });
    }
    
    res.status(201).json({
      success: true,
      data: newPOI,
    });
  } catch (error) {
    logger.error(`Erreur lors de la création d'un lieu: ${error.message}`);
    if (error.code === 11000) {
      return next(new AppError('Un lieu avec ce nom existe déjà.', 400));
    }
    next(new AppError('Impossible de créer le lieu', 500));
  }
};

// 3. Modifier un lieu existant (Pour le SuperAdmin)
exports.updatePOI = async (req, res, next) => {
  try {
    const poi = await POI.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!poi) {
      return next(new AppError('Aucun lieu trouvé avec cet identifiant', 404));
    }

    // TEMPS RÉEL
    const io = req.app.get('io');
    if (io) {
      io.emit('poi_updated', { action: 'update', poi });
    }

    res.status(200).json({
      success: true,
      data: poi,
    });
  } catch (error) {
    logger.error(`Erreur lors de la modification du lieu: ${error.message}`);
    next(new AppError('Impossible de modifier le lieu', 500));
  }
};

// 4. Supprimer un lieu (Pour le SuperAdmin)
exports.deletePOI = async (req, res, next) => {
  try {
    const poi = await POI.findByIdAndDelete(req.params.id);

    if (!poi) {
      return next(new AppError('Aucun lieu trouvé avec cet identifiant', 404));
    }

    // TEMPS RÉEL
    const io = req.app.get('io');
    if (io) {
      io.emit('poi_deleted', { id: req.params.id });
    }

    res.status(200).json({
      success: true,
      message: 'Lieu supprimé avec succès',
    });
  } catch (error) {
    logger.error(`Erreur lors de la suppression du lieu: ${error.message}`);
    next(new AppError('Impossible de supprimer le lieu', 500));
  }
};

// 5. Ajout en masse depuis un fichier JSON (Pour le SuperAdmin)
exports.bulkImportPOIs = async (req, res, next) => {
  try {
    const poisArray = req.body.pois;

    if (!poisArray || !Array.isArray(poisArray) || poisArray.length === 0) {
      return next(new AppError('Veuillez fournir un tableau valide de lieux.', 400));
    }

    const insertedPOIs = await POI.insertMany(poisArray, { ordered: false });

    // TEMPS RÉEL : On notifie d'un changement global
    const io = req.app.get('io');
    if (io) {
      io.emit('poi_updated', { action: 'bulk' });
    }

    res.status(201).json({
      success: true,
      count: insertedPOIs.length,
      message: `${insertedPOIs.length} lieux ont été ajoutés avec succès.`,
    });
  } catch (error) {
    logger.error(`Erreur lors de l'import de masse: ${error.message}`);
    if (error.code === 11000) {
      const io = req.app.get('io');
      if (io) io.emit('poi_updated', { action: 'bulk_partial' });

      return res.status(207).json({
         success: true,
         message: "Importation partielle : certains lieux existaient déjà et ont été ignorés."
      });
    }
    next(new AppError("Erreur lors de l'importation de masse des lieux.", 500));
  }
};