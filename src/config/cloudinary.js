// src/config/cloudinary.js
// CONFIGURATION CLOUDINARY - Validée via env.js
// CSCSM Level: Bank Grade

const cloudinary = require('cloudinary').v2;
const { env } = require('./env'); // On importe la config validée

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true // Force HTTPS
});

module.exports = cloudinary;    