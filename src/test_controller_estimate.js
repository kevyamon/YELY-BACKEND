// src/test_controller_estimate.js
const { generatePriceOptions } = require('./services/pricingService');
const { getRouteDistance } = require('./services/ride/rideHelpers');

const estimateRide = async (req, res) => {
  try {
    const { pickupLat, pickupLng, dropoffLat, dropoffLng, passengersCount, weather } = req.query;
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      throw new Error('Coordonnees GPS manquantes pour l\'estimation');
    }

    const origin = [parseFloat(pickupLng), parseFloat(pickupLat)];
    const destination = [parseFloat(dropoffLng), parseFloat(dropoffLat)];
    
    if (origin.some(isNaN) || destination.some(isNaN)) {
      throw new Error('Format de coordonnees GPS invalide');
    }

    console.log('Calculating distance...');
    const distance = await getRouteDistance(origin, destination);
    console.log('Distance:', distance);
    
    console.log('Calculating prices...');
    const pricingResult = await generatePriceOptions(
      origin, 
      destination, 
      distance, 
      passengersCount || 1, 
      false, 
      weather || 'sunny'
    );
    console.log('Pricing result:', pricingResult);

    const ecoPrice = pricingResult.options.find(o => o.label === 'ECO')?.amount || 200;
    const vipPrice = pricingResult.options.find(o => o.label === 'VIP')?.amount || 700;

    const vehicles = [
      { id: '1', type: 'echo', name: 'Partagé', duration: Math.max(1, Math.ceil(distance * 3)), price: ecoPrice },
      { id: '2', type: 'vip', name: 'Privé (Seul)', duration: Math.max(1, Math.ceil(distance * 1.5)), price: vipPrice }
    ];

    console.log('Response vehicles:', vehicles);
  } catch (error) {
    console.error('Controller Error:', error);
  }
};

estimateRide({
  query: {
    pickupLat: '5.4215',
    pickupLng: '-3.0285',
    dropoffLat: '5.4028',
    dropoffLng: '-3.0222'
  }
});
