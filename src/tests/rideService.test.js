// tests/rideService.test.js
const { calculatePrice, calculateDistanceKm } = require('../src/services/rideService');

describe('RideService Logic', () => {
  
  test('Calcul de distance (Haversine) doit être précis', () => {
    // Distance approx entre 2 points à Abidjan (Zone 4 -> Plateau)
    const zone4 = [-3.974, 5.295];
    const plateau = [-4.018, 5.323];
    
    const distance = calculateDistanceKm(zone4, plateau);
    // On s'attend à environ 5-6 km
    expect(distance).toBeGreaterThan(4);
    expect(distance).toBeLessThan(7);
  });

  test('Prix ECHO doit être correct (Base + Km)', () => {
    // ECHO: Base 500 + 300/km
    // Pour 10km : 500 + (300 * 10) = 3500
    const price = calculatePrice('ECHO', 10);
    expect(price).toBe(3500);
  });

  test('Prix STANDARD doit respecter le minimum', () => {
    // STANDARD: Min 1000
    // Pour 0.1km : Base 800 + (500 * 0.1) = 850, mais Min est 1000
    const price = calculatePrice('STANDARD', 0.1);
    expect(price).toBe(1000); // Doit être le prix min
  });

  test('Devrait rejeter un forfait invalide', () => {
    expect(() => {
      calculatePrice('FUSEE_SPATIALE', 10);
    }).toThrow();
  });
});