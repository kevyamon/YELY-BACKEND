// src/test_estimate.js
const axios = require('axios');

const calculateHaversineDistance = (coords1, coords2) => {
  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return parseFloat((R * c).toFixed(3));
};

const getRouteDistance = async (originCoords, destCoords) => {
  try {
    const token = 'pk.4e174e5a5b55092ab9d70c29533077b2'; // token from expo env

    const url = `https://us1.locationiq.com/v1/directions/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?key=${token}&overview=false`;
    console.log('Requesting URL:', url);
    const response = await axios.get(url, { timeout: 3000 });

    if (response.data?.routes?.length > 0) {
      const distanceMeters = response.data.routes[0].distance;
      return parseFloat((distanceMeters / 1000).toFixed(2));
    }
    throw new Error('Itineraire introuvable.');
  } catch (error) {
    console.log(`[ROUTING Error] : ${error.message}`);
    const directDist = calculateHaversineDistance(originCoords, destCoords);
    return parseFloat((directDist * 1.3).toFixed(2));
  }
};

async function test() {
  const origin = [-3.028000, 5.420000]; // Maféré center
  const destination = [-3.022268, 5.402883]; // Point in Maféré zone
  
  const dist = await getRouteDistance(origin, destination);
  console.log('Distance computed:', dist, 'km');
}

test();
