// src/utils/geoUtils.js
// UTILITAIRE GÉOLOCALISATION - Calculs de distances
// STANDARD: Industriel

/**
 * Calcule la distance entre deux points GPS en utilisant la formule de Haversine.
 * @param {Array} coords1 - [longitude, latitude] du point 1
 * @param {Array} coords2 - [longitude, latitude] du point 2
 * @returns {number} Distance en kilomètres
 */
const calculateDistance = (coords1, coords2) => {
  if (!coords1 || !coords2 || coords1.length !== 2 || coords2.length !== 2) {
    return 0; // Si les coordonnées sont invalides, on retourne 0 (par sécurité)
  }

  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Rayon de la Terre en kilomètres
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  const distance = R * c;

  return distance;
};

/**
 * Calcule le prix de livraison selon la distance (Spécifique petite ville).
 * Règle : 100 FCFA de base, 50 FCFA par km. Minimum 100, Maximum 300.
 * @param {number} distanceKm - Distance en kilomètres
 * @returns {number} Prix de livraison en FCFA
 */
const calculateDeliveryPrice = (distanceKm) => {
  const BASE_FEE = 100;
  const PRICE_PER_KM = 50;
  const MIN_PRICE = 100;
  const MAX_PRICE = 300;

  const rawPrice = BASE_FEE + (distanceKm * PRICE_PER_KM);
  
  // Plafonds et planchers mathématiques
  const finalPrice = Math.max(MIN_PRICE, Math.min(MAX_PRICE, rawPrice));
  
  // On s'assure de retourner un entier
  return Math.round(finalPrice);
};

module.exports = {
  calculateDistance,
  calculateDeliveryPrice
};
