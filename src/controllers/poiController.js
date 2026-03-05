// src/controllers/poiController.js
// CONTRÔLEUR DES LIEUX - Logique métier (Ajout, Lecture, Modification, Suppression, File d'attente)
// CSCSM Level: Bank Grade

const POI = require('../models/POI');
const Ride = require('../models/Ride'); // Ajout pour la vérification des conflits
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

// Fonction utilitaire interne : Vérifie si un lieu est verrouillé par une course active
const isPoiInUse = async (poiName) => {
  const activeStatuses = ['searching', 'negotiating', 'accepted', 'arrived', 'in_progress'];
  const inUse = await Ride.exists({
    status: { $in: activeStatuses },
    $or: [{ 'origin.address': poiName }, { 'destination.address': poiName }]
  });
  return !!inUse;
};

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
    
    // TEMPS RÉEL : On notifie tous les clients connectés via socketio
    const io = req.app.get('socketio');
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
    const poiToUpdate = await POI.findById(req.params.id);
    if (!poiToUpdate) {
      return next(new AppError('Aucun lieu trouvé avec cet identifiant', 404));
    }

    // VÉRIFICATION DE CONFLIT : Le lieu est-il en cours d'utilisation ?
    const inUse = await isPoiInUse(poiToUpdate.name);
    
    if (inUse) {
      poiToUpdate.pendingAction = 'UPDATE';
      poiToUpdate.pendingData = req.body;
      await poiToUpdate.save();
      
      return res.status(202).json({
        success: true,
        message: 'Ce lieu est actuellement utilisé par une course. La modification a été mise en attente et s\'appliquera automatiquement à la fin de la course.',
        data: poiToUpdate,
        isPending: true
      });
    }

    // Si le lieu est libre, modification immédiate
    const poi = await POI.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    // TEMPS RÉEL via socketio
    const io = req.app.get('socketio');
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
    const poi = await POI.findById(req.params.id);
    if (!poi) {
      return next(new AppError('Aucun lieu trouvé avec cet identifiant', 404));
    }

    // VÉRIFICATION DE CONFLIT
    const inUse = await isPoiInUse(poi.name);
    
    if (inUse) {
      poi.pendingAction = 'DELETE';
      await poi.save();
      
      return res.status(202).json({
        success: true,
        message: 'Ce lieu est actuellement utilisé par une course. La suppression a été mise en attente et s\'exécutera automatiquement à la fin de la course.',
        isPending: true
      });
    }

    // Si le lieu est libre, suppression immédiate
    await POI.findByIdAndDelete(req.params.id);

    // TEMPS RÉEL via socketio
    const io = req.app.get('socketio');
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

    const io = req.app.get('socketio');
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
      const io = req.app.get('socketio');
      if (io) io.emit('poi_updated', { action: 'bulk_partial' });

      return res.status(207).json({
         success: true,
         message: "Importation partielle : certains lieux existaient déjà et ont été ignorés."
      });
    }
    next(new AppError("Erreur lors de l'importation de masse des lieux.", 500));
  }
};

// 6. LIBÉRATEUR DE FILE D'ATTENTE (Fonction système appelée par le rideExecutionService)
exports.releasePendingPOI = async (poiName, io) => {
  try {
    const poi = await POI.findOne({ name: poiName, pendingAction: { $ne: 'NONE' } });
    if (!poi) return; // Aucune action en attente pour ce lieu

    // Ultime vérification : Ce lieu est-il utilisé par UNE AUTRE course simultanément ?
    const inUse = await isPoiInUse(poiName);
    if (inUse) return; // Toujours verrouillé, on annule la libération

    if (poi.pendingAction === 'DELETE') {
      await POI.findByIdAndDelete(poi._id);
      if (io) io.emit('poi_deleted', { id: poi._id });
      logger.info(`[POI SYSTEM] Exécution différée : Suppression du lieu ${poiName}`);
    } else if (poi.pendingAction === 'UPDATE') {
      Object.assign(poi, poi.pendingData);
      poi.pendingAction = 'NONE';
      poi.pendingData = {};
      await poi.save();
      if (io) io.emit('poi_updated', { action: 'update', poi });
      logger.info(`[POI SYSTEM] Exécution différée : Mise à jour du lieu ${poiName}`);
    }
  } catch (error) {
    logger.error(`[POI ERROR] Échec lors de la libération différée du lieu ${poiName}: ${error.message}`);
  }
};