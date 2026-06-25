// src/services/pricingService.js
// MOTEUR DE PRIX ADAPTE REALITES LOCALES - Multiplicateur par passager
// CSCSM Level: Bank Grade

const Decimal = require('decimal.js');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// Coordonnees approximatives des Zones de Mafere (A remplir avec le vrai KML plus tard)
// Format attendu pour MongoDB : [longitude, latitude]
const MAFERE_ZONES = {
  C: [ /* Polygone Centre-ville: tableau de [lng, lat] */ ],
  B: [ /* Polygone Quartiers */ ],
  A: [ /* Polygone Peripherie */ ]
};

// Matrice des prix de base PAR PASSAGER selon la psychologie de Mafere
const PRICE_MATRIX = {
  'C': { 'C': 200, 'B': 300, 'A': 500 },
  'B': { 'C': 300, 'B': 200, 'A': 400 },
  'A': { 'C': 500, 'B': 400, 'A': 200 }
};

// Algorithme Point in Polygon (Ray-Casting)
const isPointInPolygon = (point, polygon) => {
  if (!polygon || polygon.length === 0) return false;
  let x = point[0], y = point[1]; // Lng, Lat
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      let xi = polygon[i][0], yi = polygon[i][1];
      let xj = polygon[j][0], yj = polygon[j][1];
      let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
  }
  return inside;
};

// Detection de la zone
const detectZone = (coordinates) => {
  if (isPointInPolygon(coordinates, MAFERE_ZONES.C)) return 'C';
  if (isPointInPolygon(coordinates, MAFERE_ZONES.B)) return 'B';
  return 'A'; // Par defaut, on met en A si on n'a pas encore trace les polygones ou si hors zone
};

/**
 * Helpers pour calculer les multiplicateurs cumulatifs
 */
const getTimeMultiplier = (date = new Date()) => {
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Nuit : 22h00 à 06h00 UTC (1320 minutes à 360 minutes)
  if (timeInMinutes >= 1320 || timeInMinutes < 360) {
    return 1.25;
  }

  // Heures de pointe : 07h00 - 09h30 (420-570) et 16h30 - 19h30 (990-1170) UTC
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
 * Génère les options de prix basées sur les formules simplifiées et les multiplicateurs
 */
const generatePriceOptions = async (originCoords, destCoords, distanceKm, passengersCount = 1, isDelivery = false, weather = 'sunny', date = new Date()) => {
  
  // Sécurisation validation entrée (jusqu'à 6 places pour le covoiturage)
  const count = Math.max(1, Math.min(6, Number(passengersCount) || 1));

  if (isDelivery) {
    // LOGIQUE DE LIVRAISON DE PROXIMITÉ (PETITE VILLE)
    const dist = Number(distanceKm) || 1;
    
    // ECO (Tarif standard de base: 100F min + 30F par km), plafonné à 250F pour l'option de base
    const ecoPrice = Math.min(250, Math.max(100, Math.round(100 + dist * 30)));
    
    // STANDARD (ECO + 25F), plafonné à 275F
    const stdPrice = Math.min(275, ecoPrice + 25);
    
    // PREMIUM (ECO + 50F), plafonné à 300F (Garantie absolue du max de 300F)
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

  // 1. Détecter les zones
  const startZone = detectZone(originCoords);
  const endZone = detectZone(destCoords);

  // 2. Calculer le multiplicateur global
  const timeMult = getTimeMultiplier(date);
  const weatherMult = getWeatherMultiplier(weather);
  const totalMultiplier = timeMult * weatherMult;

  // 3. Calculer les deux forfaits requis
  
  // ECO (Partagé / Covoiturage) : base 200 + 100/km * multiplicateur + (passagers - 1) * 100
  // Capping stricte entre 200 FCFA et 500 FCFA
  const rawEco = (200 + 100 * distanceKm) * totalMultiplier + (count - 1) * 100;
  const roundedEco = Math.round(rawEco / 50) * 50;
  const ecoPrice = Math.max(200, Math.min(500, roundedEco));

  // VIP (Solo / Privé) : Flat 700 FCFA
  const vipPrice = 700;

  return {
    startZone,
    endZone,
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