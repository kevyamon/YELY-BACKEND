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
 * Genere les 3 options de prix pour la negociation basees sur la matrice des Zones et le nombre de passagers
 */
const generatePriceOptions = async (originCoords, destCoords, distanceKm, passengersCount = 1) => {
  
  // Securite validation entree
  const count = Math.max(1, Math.min(4, Number(passengersCount) || 1));

  // 1. Detecter les zones
  const startZone = detectZone(originCoords);
  const endZone = detectZone(destCoords);

  // 2. Calculer le prix de base depuis la matrice (Prix par tete)
  const basePricePerSeat = PRICE_MATRIX[startZone]?.[endZone] || 300; // 300 par defaut (Fallback)

  // 3. Application de la regle du village : Le prix se multiplie strictement par le nombre de personnes
  const totalBasePrice = basePricePerSeat * count;

  // 4. Generation des 3 Tiers (Psychologie locale)
  
  // Option 1 : ECO (Le tarif normal par tete multiplie, juste le transport)
  const ecoPrice = totalBasePrice;

  // Option 2 : STANDARD (Depart immediat sans attendre de remplir, petit bonus)
  const stdPrice = totalBasePrice + 100;

  // Option 3 : PREMIUM (Urgence, deplacement avec bagages de marche, confort)
  const premPrice = totalBasePrice + 200;

  return {
    startZone,
    endZone,
    options: [
      {
        label: 'ECO',
        amount: ecoPrice,
        description: `Tarif normal pour ${count} personne(s)`
      },
      {
        label: 'STANDARD',
        amount: stdPrice,
        description: 'Depart rapide & prioritaire'
      },
      {
        label: 'PREMIUM',
        amount: premPrice,
        description: 'Confort, urgence ou bagages'
      }
    ]
  };
};

module.exports = {
  generatePriceOptions,
  detectZone
};