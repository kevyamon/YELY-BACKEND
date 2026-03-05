// src/tests/subscriptionService.test.js
// TESTS UNITAIRES - Logique d'Abonnement et Pricing
// STANDARD: Industriel / Bank Grade

const { getSubscriptionPricing } = require('../services/subscriptionService');
const Settings = require('../models/Settings');

// Simulation du modele Settings pour tester la logique sans base de donnees
jest.mock('../models/Settings');

describe('SubscriptionService Logic', () => {
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Calcul du Pricing (getSubscriptionPricing)', () => {
    
    test('Doit retourner les prix de base si aucune promotion n\'est active', async () => {
      Settings.findOne.mockResolvedValue({ isPromoActive: false });
      
      const pricing = await getSubscriptionPricing();
      
      expect(pricing.isPromoActive).toBe(false);
      expect(pricing.weekly.price).toBe(1000);
      expect(pricing.weekly.originalPrice).toBe(1000);
      expect(pricing.monthly.price).toBe(6000);
      expect(pricing.monthly.originalPrice).toBe(6000);
    });

    test('Doit appliquer strictement la reduction de 40% si la promotion est active', async () => {
      Settings.findOne.mockResolvedValue({ isPromoActive: true });
      
      const pricing = await getSubscriptionPricing();
      
      expect(pricing.isPromoActive).toBe(true);
      // 1000 * 0.6 = 600
      expect(pricing.weekly.price).toBe(600);
      expect(pricing.weekly.originalPrice).toBe(1000);
      // 6000 * 0.6 = 3600
      expect(pricing.monthly.price).toBe(3600);
      expect(pricing.monthly.originalPrice).toBe(6000);
    });

    test('Doit gerer le cas ou la table Settings est vide', async () => {
      Settings.findOne.mockResolvedValue(null);
      
      const pricing = await getSubscriptionPricing();
      
      expect(pricing.isPromoActive).toBe(false);
      expect(pricing.weekly.price).toBe(1000);
    });
  });
});