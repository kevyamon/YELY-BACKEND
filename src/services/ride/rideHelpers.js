// src/services/ride/rideHelpers.js
// HELPER METIER - Calculs geographiques et enrichissement d'adresses
// STANDARD: Industriel / Bank Grade

const axios = require('axios');
const POI = require('../../models/POI');
const { env } = require('../../config/env');
const logger = require('../../config/logger');

const calculateHaversineDistance = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return parseFloat((R * c).toFixed(3));
};

const enrichAddressWithPOI = async (address, coords, redisClient) => {
  try {
    let pois = [];
    const cachedPOIs = await redisClient.get('yely_active_pois');
    
    if (cachedPOIs) {
      pois = JSON.parse(cachedPOIs);
    } else {
      pois = await POI.find({ isActive: true }).select('name latitude longitude').lean();
      await redisClient.set('yely_active_pois', JSON.stringify(pois), 'EX', 3600); 
    }

    if (!pois || pois.length === 0) return address;

    let nearestPOI = null;
    let minDistanceKm = Infinity;

    for (const poi of pois) {
      const distKm = calculateHaversineDistance(coords, [poi.longitude, poi.latitude]);
      if (distKm < minDistanceKm) {
        minDistanceKm = distKm;
        nearestPOI = poi;
      }
    }

    const distanceInMeters = Math.round(minDistanceKm * 1000);

    if (distanceInMeters <= 1500 && nearestPOI) {
      const formattedDist = distanceInMeters < 1000 ? `${distanceInMeters}m` : `${(distanceInMeters / 1000).toFixed(1)}km`;
      
      let baseAddress = address;
      if (address.toLowerCase().includes('maféré') || address.toLowerCase().includes('aboisso')) {
        baseAddress = 'Maféré';
      } else {
        baseAddress = address.split(',')[0].trim();
      }
      
      return `${baseAddress} (A ${formattedDist} de : ${nearestPOI.name})`;
    }

    return address;
  } catch (error) {
    logger.warn(`[POI ENRICHMENT] Echec silencieux de la contextualisation : ${error.message}`);
    return address;
  }
};

const resolveCoordsFromAddress = async (address, sellerName, redisClient) => {
  const fallbackCoords = [-3.0325855, 5.4125925];
  try {
    let pois = [];
    const cachedPOIs = await redisClient.get('yely_active_pois');
    if (cachedPOIs) {
      pois = JSON.parse(cachedPOIs);
    } else {
      pois = await POI.find({ isActive: true }).select('name latitude longitude').lean();
      await redisClient.set('yely_active_pois', JSON.stringify(pois), 'EX', 3600);
    }

    if (!pois || pois.length === 0) return fallbackCoords;

    const addrStr = String(address || '').trim().toLowerCase();
    const nameStr = String(sellerName || '').trim().toLowerCase();

    const match = addrStr.match(/de\s*:\s*([^)]+)/i);
    if (match) {
      const poiName = match[1].trim().toLowerCase();
      const foundPoi = pois.find(p => p.name.toLowerCase() === poiName);
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];
    }

    if (addrStr && addrStr !== 'point de retrait vendeur') {
      let foundPoi = pois.find(p => p.name.toLowerCase() === addrStr);
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];

      foundPoi = pois.find(p => addrStr.includes(p.name.toLowerCase()));
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];

      foundPoi = pois.find(p => p.name.toLowerCase().includes(addrStr));
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];
    }

    if (nameStr) {
      let foundPoi = pois.find(p => p.name.toLowerCase() === nameStr);
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];

      foundPoi = pois.find(p => nameStr.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(nameStr));
      if (foundPoi) return [foundPoi.longitude, foundPoi.latitude];
    }

    const centrePoi = pois.find(p => p.name.toLowerCase().includes('centre'));
    if (centrePoi) return [centrePoi.longitude, centrePoi.latitude];

    return fallbackCoords;
  } catch (error) {
    logger.warn(`[POI RESOLUTION] Echec silencieux de la resolution d'adresse : ${error.message}`);
    return fallbackCoords;
  }
};

const getRouteDistance = async (originCoords, destCoords) => {
  try {
    const token = env.LOCATION_IQ_TOKEN;
    if (!token) throw new Error("Token LocationIQ manquant.");

    const url = `https://us1.locationiq.com/v1/directions/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?key=${token}&overview=false`;
    const response = await axios.get(url, { timeout: 3000 });

    if (response.data?.routes?.length > 0) {
      const distanceMeters = response.data.routes[0].distance;
      return parseFloat((distanceMeters / 1000).toFixed(2));
    }
    throw new Error('Itineraire introuvable.');
  } catch (error) {
    logger.warn(`[ROUTING] Fallback active: ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2));
  }
};

module.exports = {
  calculateHaversineDistance,
  enrichAddressWithPOI,
  resolveCoordsFromAddress,
  getRouteDistance
};
