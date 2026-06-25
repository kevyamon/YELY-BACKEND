// src/test_remote_estimate.js
const axios = require('axios');

async function test() {
  const url = 'https://yely-backend-yzw4.onrender.com/api/v1/rides/estimate?pickupLat=5.4215&pickupLng=-3.0285&dropoffLat=5.4028&dropoffLng=-3.0222';
  console.log('Fetching remote estimate...');
  try {
    const res = await axios.get(url);
    console.log('Success:', res.data);
  } catch (error) {
    if (error.response) {
      console.log('Error status:', error.response.status);
      console.log('Error data:', error.response.data);
    } else {
      console.log('Error message:', error.message);
    }
  }
}

test();
