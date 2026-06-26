const axios = require('axios');
const POI = require('../models/POI');
const Ride = require('../models/Ride');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');

// Zone KML Maféré précise extraite du fichier Google Earth KML
// Format : [longitude, latitude]
const MAFERE_KML_ZONE = [
  [-3.051197610717613, 5.389355738252305],
  [-2.984380345561231, 5.389703322002365],
  [-2.987065237052784, 5.427887081546217],
  [-2.987269034128919, 5.443134554765992],
  [-3.036311394541528, 5.449104421664392],
  [-3.06092929087994, 5.445598242581576],
  [-3.075460658993872, 5.433245102067395],
  [-3.079244234523882, 5.417993563246123],
  [-3.078000651410526, 5.404791835726621],
  [-3.051197610717613, 5.389355738252305]
];

// Algorithme Point in Polygon (Ray-Casting)
const isPointInPolygon = (point, polygon) => {
  if (!polygon || polygon.length === 0) return false;
  const x = point[0], y = point[1]; // Lng, Lat
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
  }
  return inside;
};

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

// 7. Recherche Hybride avec Cache (Nominatim + Google Maps Fallback)
exports.searchPOIs = async (req, res, next) => {
  try {
    const query = req.query.q ? String(req.query.q).trim() : '';
    
    // a. Recherche locale d'abord
    let localPois = [];
    if (query) {
      localPois = await POI.find({
        isActive: true,
        name: { $regex: query, $options: 'i' }
      }).limit(10).lean();
    } else {
      localPois = await POI.find({ isActive: true }).limit(5).lean();
    }

    // Si on a suffisamment de résultats locaux ou pas de requête de recherche, on s'arrête là
    if (localPois.length >= 5 || !query || query.length < 2) {
      return res.status(200).json({
        success: true,
        count: localPois.length,
        data: localPois
      });
    }

    // b. Interrogation de Nominatim (OpenStreetMap) en direct
    let externalResults = [];
    try {
      const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Cote d\'Ivoire')}&format=json&limit=8&addressdetails=1`;
      const response = await axios.get(osmUrl, {
        headers: { 'User-Agent': 'YelyApp-API/1.0' },
        timeout: 2500
      });

      if (response.data && Array.isArray(response.data)) {
        externalResults = response.data
          .map(item => {
            const lat = parseFloat(item.lat);
            const lon = parseFloat(item.lon);
            
            // FILTRE SÉCURISÉ : On limite strictement la recherche à la zone KML de Maféré
            const inside = isPointInPolygon([lon, lat], MAFERE_KML_ZONE);
            if (!inside) return null;

            const name = item.display_name.split(',')[0];
            const street = item.address?.road || item.address?.pedestrian || item.address?.suburb || '';
            const finalName = name + (street ? `, ${street}` : '');

            return {
              _id: `osm_${item.place_id}`,
              name: finalName,
              latitude: lat,
              longitude: lon,
              icon: 'Ionicons/earth-outline',
              iconColor: '#3498db',
              isExternal: true,
              source: 'osm'
            };
          })
          .filter(Boolean);
      }
    } catch (err) {
      logger.warn(`[NOMINATIM SEARCH] Échec de la recherche Nominatim: ${err.message}`);
    }

    // c. Interrogation de Google Places en secours si Nominatim est vide et si clé configurée
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (externalResults.length === 0 && googleKey) {
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ', Mafere, Cote d\'Ivoire')}&key=${googleKey}`;
        const gResponse = await axios.get(googleUrl, { timeout: 2500 });
        
        if (gResponse.data?.results) {
          externalResults = gResponse.data.results
            .map(item => {
              const lat = item.geometry?.location?.lat;
              const lng = item.geometry?.location?.lng;
              if (!lat || !lng) return null;

              // FILTRE SÉCURISÉ : On limite strictement la recherche à la zone KML de Maféré
              const inside = isPointInPolygon([lng, lat], MAFERE_KML_ZONE);
              if (!inside) return null;

              return {
                _id: `google_${item.place_id}`,
                name: item.name + (item.formatted_address ? `, ${item.formatted_address.split(',')[0]}` : ''),
                latitude: lat,
                longitude: lng,
                icon: 'Ionicons/earth-outline',
                iconColor: '#3498db',
                isExternal: true,
                source: 'google'
              };
            })
            .filter(Boolean);
        }
      } catch (err) {
        logger.warn(`[GOOGLE SEARCH] Échec de recherche Google Places: ${err.message}`);
      }
    }

    // d. Fusion et élimination des doublons de noms locaux
    const localNames = new Set(localPois.map(p => p.name.toLowerCase().trim()));
    const filteredExternal = externalResults.filter(item => !localNames.has(item.name.toLowerCase().trim()));

    const mergedResults = [...localPois, ...filteredExternal];

    return res.status(200).json({
      success: true,
      count: mergedResults.length,
      data: mergedResults
    });
  } catch (error) {
    logger.error(`Erreur lors de la recherche hybride: ${error.message}`);
    next(new AppError('Erreur lors de la recherche de lieu', 500));
  }
};

// 8. Résolution d'un point externe en POI Persistant
exports.resolveExternalPOI = async (req, res, next) => {
  try {
    const { name, latitude, longitude, icon, iconColor } = req.body;

    if (!name || !latitude || !longitude) {
      return next(new AppError('Données de résolution géospatiale incomplètes.', 400));
    }

    // Vérifier si le point est dans notre polygone KML Maféré
    const inside = isPointInPolygon([Number(longitude), Number(latitude)], MAFERE_KML_ZONE);
    if (!inside) {
      return next(new AppError("Ce lieu se trouve en dehors de la zone de service active de Maféré.", 400));
    }

    // Recherche d'un POI de nom identique déjà validé
    let poi = await POI.findOne({ name: name.trim() });
    
    if (!poi) {
      poi = await POI.create({
        name: name.trim(),
        latitude: Number(latitude),
        longitude: Number(longitude),
        icon: icon || 'Ionicons/location',
        iconColor: iconColor || '#D4AF37',
        isActive: true
      });

      const io = req.app.get('socketio');
      if (io) io.emit('poi_updated', { action: 'create', poi });
      logger.info(`[POI CACHE] Nouveau point externe résolu et mis en cache : ${name}`);
    }

    return res.status(200).json({
      success: true,
      data: poi
    });
  } catch (error) {
    logger.error(`Erreur lors de la résolution du lieu externe: ${error.message}`);
    next(new AppError('Impossible de mettre en cache ce lieu.', 500));
  }
};

// 9. Proposition de lieu par un Utilisateur ou Chauffeur (Crowdsourcing)
exports.suggestPOI = async (req, res, next) => {
  try {
    const { name, latitude, longitude, icon, iconColor } = req.body;

    if (!name || !latitude || !longitude) {
      return next(new AppError('Veuillez renseigner un nom et des coordonnées.', 400));
    }

    // Validation géographique dans Maféré
    const inside = isPointInPolygon([Number(longitude), Number(latitude)], MAFERE_KML_ZONE);
    if (!inside) {
      return next(new AppError("Les propositions doivent se situer dans la zone active de Maféré.", 400));
    }

    // Création du POI inactif en attente d'approbation superadmin
    const newPOI = await POI.create({
      name: name.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      icon: icon || 'Ionicons/help-circle-outline',
      iconColor: iconColor || '#7F8C8D',
      isActive: false, // Inactif jusqu'à validation superadmin
      isSuggested: true,
      suggestedBy: req.user._id
    });

    const io = req.app.get('socketio');
    if (io) io.emit('poi_updated', { action: 'suggest', poi: newPOI });

    return res.status(201).json({
      success: true,
      message: 'Proposition enregistrée. Elle apparaîtra sur la carte dès sa validation par l\'administrateur.',
      data: newPOI
    });
  } catch (error) {
    logger.error(`Erreur suggestion lieu: ${error.message}`);
    if (error.code === 11000) {
      return next(new AppError('Un lieu avec ce nom existe déjà.', 400));
    }
    next(new AppError('Impossible d\'enregistrer la proposition.', 500));
  }
};

// 10. Liste complète des POIs pour le SuperAdmin (incluant inactifs et suggestions)
exports.getAdminPOIs = async (req, res, next) => {
  try {
    const pois = await POI.find({}).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: pois.length,
      data: pois
    });
  } catch (error) {
    logger.error(`Erreur admin get POIs: ${error.message}`);
    next(new AppError('Impossible de récupérer la liste d\'administration.', 500));
  }
};

// 11. Importation Automatique OpenStreetMap via Overpass API
exports.autoImportPOIs = async (req, res, next) => {
  try {
    const radius = Number(req.body.radius) || 6000;
    
    // Le centre de Maféré (latitude: 5.420000, longitude: -3.028000)
    const centerLat = 5.420000;
    const centerLng = -3.028000;

    const overpassUrl = 'https://overpass-api.de/api/interpreter';
    const overpassQuery = `[out:json][timeout:25];(node["amenity"~"school|university|college|pharmacy|hospital|clinic|doctors|fuel|townhall|police|post_office|place_of_worship|bank|atm|supermarket"](around:${radius},${centerLat},${centerLng});way["amenity"~"school|university|college|pharmacy|hospital|clinic|doctors|fuel|townhall|police|post_office|place_of_worship|bank|atm|supermarket"](around:${radius},${centerLat},${centerLng}););out center;`;

    logger.info(`[OSM IMPORT] Lancement de l'importation Overpass sur un rayon de ${radius}m autour de Maféré...`);
    
    const url = `${overpassUrl}?data=${encodeURIComponent(overpassQuery)}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'YelyApp-POI-Importer/1.0 (contact@yely.com)' },
      timeout: 15000
    });

    const elements = response.data?.elements || [];
    if (elements.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Aucun nouveau point d\'intérêt trouvé sur OpenStreetMap pour cette zone.',
        importedCount: 0
      });
    }

    let importedCount = 0;
    
    for (const element of elements) {
      const name = element.tags?.name;
      if (!name || name.trim() === '') continue;

      const elementLat = element.lat || element.center?.lat;
      const elementLon = element.lon || element.center?.lon;
      if (!elementLat || !elementLon) continue;

      // FILTRE SÉCURISÉ : On limite strictement au tracé KML de Maféré !
      if (!isPointInPolygon([elementLon, elementLat], MAFERE_KML_ZONE)) continue;

      // Association d'icônes et couleurs adaptées
      const amenity = element.tags.amenity || '';
      let icon = 'Ionicons/location';
      let iconColor = '#D4AF37';

      if (['school', 'university', 'college', 'kindergarten'].includes(amenity)) {
        icon = 'Ionicons/school';
        iconColor = '#3498db'; // Bleu
      } else if (amenity === 'pharmacy') {
        icon = 'Ionicons/medical';
        iconColor = '#2ecc71'; // Vert
      } else if (['hospital', 'clinic', 'doctors', 'dentist'].includes(amenity)) {
        icon = 'Ionicons/heart';
        iconColor = '#e74c3c'; // Rouge
      } else if (amenity === 'fuel') {
        icon = 'Ionicons/car-sport';
        iconColor = '#e67e22'; // Orange
      } else if (['townhall', 'police', 'post_office', 'courthouse'].includes(amenity)) {
        icon = 'Ionicons/business';
        iconColor = '#8e44ad'; // Violet
      } else if (amenity === 'place_of_worship') {
        icon = 'Ionicons/trail-sign';
        iconColor = '#f1c40f'; // Jaune
      } else if (['bank', 'atm'].includes(amenity)) {
        icon = 'Ionicons/card';
        iconColor = '#1abc9c'; // Turquoise
      } else if (['supermarket', 'marketplace', 'mall'].includes(amenity)) {
        icon = 'Ionicons/basket';
        iconColor = '#27ae60'; // Vert foncé
      }

      // Insertion sécurisée : on ne recrée pas si un POI avec ce nom exact existe
      const exists = await POI.exists({ name: name.trim() });
      if (!exists) {
        await POI.create({
          name: name.trim(),
          latitude: elementLat,
          longitude: elementLon,
          icon,
          iconColor,
          isActive: true
        });
        importedCount++;
      }
    }

    const io = req.app.get('socketio');
    if (io && importedCount > 0) {
      io.emit('poi_updated', { action: 'bulk' });
    }

    return res.status(200).json({
      success: true,
      message: `${importedCount} points d'intérêt importés et validés avec succès à l'intérieur de la zone Maféré.`,
      importedCount
    });
  } catch (error) {
    logger.error(`Erreur lors de l'auto-importation OSM: ${error.message}`);
    next(new AppError('Échec de la récupération des données cartographiques OSM.', 500));
  }
};