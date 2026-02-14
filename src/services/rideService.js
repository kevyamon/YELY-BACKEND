// src/services/rideService.js
// LOGIQUE MÉTIER COURSES - Tarification & Géométrie
// CSCSM Level: Bank Grade

// Tarifs officiels (Source de vérité unique)
const OFFICIAL_PRICING = {
  ECHO: { base: 500, perKm: 300, minPrice: 800, maxPrice: 5000 },
  STANDARD: { base: 800, perKm: 400, minPrice: 1200, maxPrice: 8000 },
  VIP: { base: 1500, perKm: 700, minPrice: 2500, maxPrice: 15000 }
};

/**
 * Calcule la distance entre deux points (Formule Haversine)
 * @returns {number} Distance en km
 */
const calculateDistanceKm = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;
  
  const R = 6371; // Rayon terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
            
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  // On arrondit à 2 décimales pour la propreté
  return parseFloat((R * c).toFixed(2));
};

/**
 * Calcule le prix de la course selon le forfait
 */
const calculatePrice = (forfait, distanceKm) => {
  const pricing = OFFICIAL_PRICING[forfait];
  if (!pricing) throw new Error('INVALID_FORFAIT');
  
  let price = pricing.base + (distanceKm * pricing.perKm);
  
  // Bornes Min/Max
  price = Math.max(pricing.minPrice, Math.min(pricing.maxPrice, price));
  
  // Arrondi au 50 FCFA supérieur (règle commerciale fréquente)
  return Math.ceil(price / 50) * 50;
};

/**
 * Orchestre le calcul complet d'une estimation
 */
const computeRideDetails = (originCoords, destCoords, forfait) => {
  const distance = calculateDistanceKm(originCoords, destCoords);
  const price = calculatePrice(forfait, distance);
  
  return { distance, price };
};

module.exports = {
  calculateDistanceKm,
  calculatePrice,
  computeRideDetails,
  OFFICIAL_PRICING
};