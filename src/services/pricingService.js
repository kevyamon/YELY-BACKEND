// src/services/pricingService.js
// MOTEUR DE PRIX "GAMIFIÉ" - 3 Options Sécurisées
// CSCSM Level: Bank Grade

const Decimal = require('decimal.js');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// Coordonnées approximatives des Zones de Maféré (A remplir avec le vrai KML plus tard)
// Format attendu pour MongoDB : [longitude, latitude]
const MAFERE_ZONES = {
  C: [ /* Polygone Centre-ville: tableau de [lng, lat] */ ],
  B: [ /* Polygone Quartiers */ ],
  A: [ /* Polygone Périphérie */ ]
};

// Matrice des prix selon la psychologie de Maféré
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

// Détection de la zone
const detectZone = (coordinates) => {
  if (isPointInPolygon(coordinates, MAFERE_ZONES.C)) return 'C';
  if (isPointInPolygon(coordinates, MAFERE_ZONES.B)) return 'B';
  return 'A'; // Par défaut, on met en A si on n'a pas encore tracé les polygones ou si hors zone
};

/**
 * Génère les 3 options de prix pour la négociation basées sur la matrice des Zones
 */
const generatePriceOptions = async (originCoords, destCoords, distanceKm) => {
  
  // 1. Détecter les zones
  const startZone = detectZone(originCoords);
  const endZone = detectZone(destCoords);

  // 2. Calculer le prix de base depuis la matrice
  const basePrice = PRICE_MATRIX[startZone]?.[endZone] || 300; // 300 par défaut (Fallback)

  // 3. Génération des 3 Tiers (Psychologie)
  
  // Option 1 : ECO (Le tarif normal accepté par la population)
  const ecoPrice = basePrice;

  // Option 2 : STANDARD (Départ prioritaire, pluie, nuit, ou léger bagage)
  const stdPrice = basePrice + 100;

  // Option 3 : PREMIUM (Urgence absolue, confort garanti)
  const premPrice = basePrice + 200;

  // On renvoie un objet restructuré pour permettre à rideService de sauvegarder les zones
  return {
    startZone,
    endZone,
    options: [
      {
        label: 'ECO',
        amount: ecoPrice,
        description: 'Tarif normal de la zone'
      },
      {
        label: 'STANDARD',
        amount: stdPrice,
        description: 'Départ prioritaire'
      },
      {
        label: 'PREMIUM',
        amount: premPrice,
        description: 'Confort et urgence'
      }
    ]
  };
};

module.exports = {
  generatePriceOptions,
  detectZone
};