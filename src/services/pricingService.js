// src/services/pricingService.js
// MOTEUR DE PRIX ADAPTE REALITES LOCALES - Multiplicateur par passager
// CSCSM Level: Bank Grade

const Decimal = require('decimal.js');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const axios = require('axios');
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

// Détection de la zone (utilisé pour de futures expansions ou logiques secondaires)
const detectZone = (coordinates) => {
  return isPointInPolygon(coordinates, MAFERE_KML_ZONE) ? 'C' : 'A';
};

/**
 * Récupère la météo en direct pour des coordonnées GPS via Open-Meteo API
 */
const fetchLiveWeather = async (lat, lng) => {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
    const response = await axios.get(url, { timeout: 2000 });
    const code = response.data?.current_weather?.weathercode;
    
    // Codes météo Open-Meteo pour la pluie (51-67, 80-82, 95-99)
    if (code !== undefined) {
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) {
        return 'rainy';
      }
    }
    return 'sunny';
  } catch (error) {
    logger.warn(`[WEATHER SERVICE] Échec de la récupération météo en direct: ${error.message}. Repli sur "sunny"`);
    return 'sunny';
  }
};

/**
 * Calculateurs de multiplicateurs temporels et météorologiques
 */
const getTimeMultiplier = (date = new Date()) => {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Nuit : 22h00 à 06h00 UTC
  if (timeInMinutes >= 1320 || timeInMinutes < 360) {
    return 1.25;
  }

  // Heures de pointe : 07h00 - 09h30 UTC et 16h30 - 19h30 UTC
  if ((timeInMinutes >= 420 && timeInMinutes <= 570) || (timeInMinutes >= 990 && timeInMinutes <= 1170)) {
    return 1.20;
  }

  return 1.00;
};

const getWeatherMultiplier = (weather = 'sunny') => {
  if (weather && ['rainy', 'rain', 'pluie', 'pleut'].includes(weather.toLowerCase())) {
    return 1.15;
  }
  return 1.00;
};

/**
 * Génère les options de prix basées sur les formules et les multiplicateurs
 */
const generatePriceOptions = async (originCoords, destCoords, distanceKm, passengersCount = 1, isDelivery = false, weather = 'sunny', date = new Date()) => {
  
  // 1. Validation de la couverture géographique (Limitation stricte au KML)
  const isOriginInZone = isPointInPolygon(originCoords, MAFERE_KML_ZONE);
  const isDestInZone = isPointInPolygon(destCoords, MAFERE_KML_ZONE);

  if (!isOriginInZone || !isDestInZone) {
    throw new AppError("Service indisponible. Yély est uniquement actif dans les limites de la commune de Maféré.", 400);
  }

  const count = Math.max(1, Math.min(6, Number(passengersCount) || 1));

  if (isDelivery) {
    // LOGIQUE DE LIVRAISON DE PROXIMITÉ (PETITE VILLE)
    const dist = Number(distanceKm) || 1;
    const ecoPrice = Math.min(250, Math.max(100, Math.round(100 + dist * 30)));
    const stdPrice = Math.min(275, ecoPrice + 25);
    const premPrice = Math.min(300, ecoPrice + 50);

    return {
      startZone: 'C',
      endZone: 'C',
      options: [
        {
          label: 'ECO',
          amount: ecoPrice,
          description: 'Livraison standard (économique)'
        },
        {
          label: 'STANDARD',
          amount: stdPrice,
          description: 'Livraison prioritaire'
        },
        {
          label: 'PREMIUM',
          amount: premPrice,
          description: 'Livraison express ou colis volumineux (max 300 FCFA)'
        }
      ]
    };
  }

  // 2. Récupération de la météo en direct si non fournie ou par défaut
  let resolvedWeather = weather;
  if (!weather || weather === 'sunny') {
    resolvedWeather = await fetchLiveWeather(originCoords[1], originCoords[0]);
  }

  // 3. Calcul des multiplicateurs
  const timeMult = getTimeMultiplier(date);
  const weatherMult = getWeatherMultiplier(resolvedWeather);

  // 4. Calcul du forfait ECO (Partagé / Covoiturage)
  // Base brute pour 1 place : (200 + 100 * distance) * time * weather
  const rawSingleEco = (200 + 100 * distanceKm) * timeMult * weatherMult;
  // Arrondi aux 50 FCFA les plus proches et capping entre 200 et 500 FCFA pour une seule place
  const singleEcoPrice = Math.max(200, Math.min(500, Math.round(rawSingleEco / 50) * 50));
  // Ajout des places supplémentaires avec incrément dégressif fixé à 150 FCFA par personne additionnelle
  const ecoPrice = singleEcoPrice + (count - 1) * 150;

  // 5. Calcul du forfait VIP (Privé - Solo)
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;
  // Nuit : 23h30 à 05h00 UTC
  const isNight = timeInMinutes >= 1410 || timeInMinutes < 300;

  let vipPrice = 700;
  if (isNight) {
    vipPrice = 800; // Tarif plat de nuit
  } else {
    // En journée standard : 700, pluvieux : 800 maximum
    if (weatherMult > 1.00) {
      vipPrice = Math.min(800, Math.round((700 * weatherMult) / 50) * 50);
    }
  }

  return {
    startZone: 'C',
    endZone: 'C',
    options: [
      {
        label: 'ECO',
        amount: ecoPrice,
        description: `Option partagée (Covoiturage) - ${count} place(s)`
      },
      {
        label: 'VIP',
        amount: vipPrice,
        description: 'Option privée (Seul dans le taxi)'
      }
    ]
  };
};

module.exports = {
  generatePriceOptions,
  detectZone
};