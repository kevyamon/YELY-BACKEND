// src/services/pricingService.js
// MOTEUR DE PRIX "GAMIFIÉ" - 3 Options Sécurisées
// CSCSM Level: Bank Grade

const Decimal = require('decimal.js');
const Settings = require('../models/Settings');
const AppError = require('../utils/AppError');

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// Tarifs de base par défaut (Fallback)
const DEFAULT_RULES = {
  base: 500,
  perKm: 400,
  minPrice: 1000,
  maxPrice: 10000
};

/**
 * Génère les 3 options de prix pour la négociation
 */
const generatePriceOptions = async (distanceKm) => {
  // 1. Récupérer config dynamique
  let rules = DEFAULT_RULES;
  try {
    const settings = await Settings.findOne().lean();
    if (settings && settings.pricingRules) {
      rules = settings.pricingRules.STANDARD || DEFAULT_RULES;
    }
  } catch (err) {
    console.warn('[PRICING] Fallback default rules');
  }

  const dist = new Decimal(distanceKm);
  const base = new Decimal(rules.base);
  const perKm = new Decimal(rules.perKm);

  // Calcul du "Prix Juste" (Pivot)
  // Formule : Base + (Dist * Km)
  let pivotPrice = base.plus(dist.times(perKm));
  
  // Bornes Min/Max globales
  const minLimit = new Decimal(rules.minPrice);
  const maxLimit = new Decimal(rules.maxPrice);

  if (pivotPrice.lessThan(minLimit)) pivotPrice = minLimit;
  if (pivotPrice.greaterThan(maxLimit)) pivotPrice = maxLimit;

  // 2. Génération des 3 Tiers (Psychologie)
  
  // Option 1 : ECO (Le chauffeur accepte un peu moins pour aller vite)
  // -10% du prix juste, mais jamais sous le minimum
  let ecoPrice = pivotPrice.times(0.9);
  if (ecoPrice.lessThan(minLimit)) ecoPrice = minLimit;

  // Option 2 : STANDARD (Le prix algorithmique parfait)
  let stdPrice = pivotPrice;

  // Option 3 : PREMIUM (Le chauffeur tente sa chance)
  // +15% du prix juste
  let premPrice = pivotPrice.times(1.15);
  if (premPrice.greaterThan(maxLimit)) premPrice = maxLimit;

  // 3. Arrondi commercial (50 FCFA) pour faire propre
  const step = new Decimal(50);
  const round = (val) => val.div(step).ceil().times(step).toNumber();

  return [
    {
      label: 'ECO',
      amount: round(ecoPrice),
      description: 'Prix compétitif pour départ immédiat'
    },
    {
      label: 'STANDARD',
      amount: round(stdPrice),
      description: 'Tarif normal du marché'
    },
    {
      label: 'PREMIUM',
      amount: round(premPrice),
      description: 'Priorité élevée'
    }
  ];
};

module.exports = {
  generatePriceOptions
};