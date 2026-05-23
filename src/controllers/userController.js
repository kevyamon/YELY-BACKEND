//src/controllers/userController.js
// CONTROLEUR UTILISATEUR - Gestion Profil & Disponibilite
// CSCSM Level: Bank Grade

const User = require('../models/User');
const Product = require('../models/Product');
const userService = require('../services/userService');
const { clearRefreshTokenCookie } = require('../utils/tokenService');
const { successResponse } = require('../utils/responseHandler');
const AppError = require('../utils/AppError');

const getProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserProfile(req.user._id);
    if (user && user.role === 'seller' && !user.shopSlug) {
      await getOrCreateSellerSlug(user);
    }
    return successResponse(res, user, 'Profil recupere');
  } catch (error) {
    return next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const allowedUpdates = ['name', 'phone', 'vehicle', 'hasFollowedFB'];
    const updates = Object.keys(req.body);
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) throw new AppError('Mise a jour non autorisee', 400);

    const user = await userService.updateProfile(req.user._id, req.body);
    return successResponse(res, user, 'Profil mis a jour');
  } catch (error) {
    return next(error);
  }
};

const uploadProfilePicture = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError("Aucune image fournie", 400);
    const user = await userService.uploadProfilePicture(req.user._id, req.file);
    return successResponse(res, { profilePicture: user.profilePicture }, 'Photo de profil mise a jour');
  } catch (error) {
    return next(error);
  }
};

const deleteAccount = async (req, res, next) => {
  try {
    await userService.anonymizeAccount(req.user._id);
    
    // Purge de la session
    clearRefreshTokenCookie(res);
    const redisClient = require('../config/redis');
    try { await redisClient.del(`auth:user:${req.user._id}`); } catch(e) {}

    return successResponse(res, null, 'Compte supprime definitivement');
  } catch (error) {
    return next(error);
  }
};

const updateAvailability = async (req, res, next) => {
  try {
    const { isAvailable } = req.body;
    
    if (typeof isAvailable !== 'boolean') {
      throw new AppError('Statut de disponibilite invalide', 400);
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isAvailable },
      { new: true, runValidators: true }
    ).select('isAvailable totalRides totalEarnings rating');

    return successResponse(res, user, `Vous etes maintenant ${isAvailable ? 'en service' : 'hors ligne'}`);
  } catch (error) {
    return next(error);
  }
};

const getSellers = async (req, res, next) => {
  try {
    const { search } = req.query;
    const query = { role: 'seller', isBanned: false, isDeleted: false };
    if (search) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    const sellers = await User.find(query).select('name profilePicture rating');
    const sellersWithCount = await Promise.all(sellers.map(async (seller) => {
      const count = await Product.countDocuments({ seller: seller._id, isActive: true });
      return {
        ...seller.toObject(),
        productCount: count
      };
    }));
    return successResponse(res, sellersWithCount, 'Vendeurs récupérés avec succès');
  } catch (error) {
    return next(error);
  }
};

const getSellerProfile = async (req, res, next) => {
  try {
    const idOrSlug = req.params.id;
    let query = { role: 'seller', isBanned: false, isDeleted: false };
    
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      query._id = idOrSlug;
    } else {
      query.shopSlug = idOrSlug;
    }

    const seller = await User.findOne(query).select('name profilePicture rating email phone shopSlug');
    if (!seller) {
      throw new AppError('Vendeur introuvable', 404);
    }
    if (!seller.shopSlug) {
      await getOrCreateSellerSlug(seller);
    }
    const count = await Product.countDocuments({ seller: seller._id, isActive: true });
    return successResponse(res, {
      ...seller.toObject(),
      productCount: count
    }, 'Profil vendeur récupéré');
  } catch (error) {
    return next(error);
  }
};

const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const crypto = require('crypto');

// Helpers de génération de slug
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
};

const getOrCreateSellerSlug = async (seller) => {
  if (seller.shopSlug) return seller.shopSlug;
  const baseSlug = slugify(seller.name || 'boutique');
  const randomHex = crypto.randomBytes(3).toString('hex');
  const uniqueSlug = `${baseSlug}-${randomHex}`;
  seller.shopSlug = uniqueSlug;
  await seller.save({ validateBeforeSave: false });
  return uniqueSlug;
};

// Helper pour générer l'image Open Graph avec overlays
const getShareImageUrl = async (seller) => {
  try {
    const cloudName = cloudinary.config().cloud_name || 'dpxslyr71';
    
    let baseImageUrl = seller.profilePicture;
    let publicId = '';
    let isCloudinary = false;

    if (baseImageUrl && baseImageUrl.includes('cloudinary.com')) {
      const parts = baseImageUrl.split('/image/upload/');
      if (parts.length >= 2) {
        const pathPart = parts[1].replace(/^v\d+\//, '');
        const dotIndex = pathPart.lastIndexOf('.');
        publicId = dotIndex !== -1 ? pathPart.substring(0, dotIndex) : pathPart;
        isCloudinary = true;
      }
    }

    if (!publicId) {
      publicId = 'yely/assets/yely_default_storefront';
      isCloudinary = true;
    }
    
    const logoOverlay = 'yely:assets:yely_logo_overlay';
    const badgeOverlay = 'yely:assets:yely_verified_badge_overlay';

    if (isCloudinary) {
      return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,g_face,w_500,h_500/l_${logoOverlay},w_110,r_max/fl_layer_apply,g_south_east,x_15,y_15/l_${badgeOverlay},w_70/fl_layer_apply,g_north_east,x_15,y_15/${publicId}.jpg`;
    } else {
      const encodedBaseUrl = encodeURIComponent(baseImageUrl);
      return `https://res.cloudinary.com/${cloudName}/image/fetch/c_fill,g_face,w_500,h_500/l_${logoOverlay},w_110,r_max/fl_layer_apply,g_south_east,x_15,y_15/l_${badgeOverlay},w_70/fl_layer_apply,g_north_east,x_15,y_15/${encodedBaseUrl}`;
    }
  } catch (error) {
    logger.error(`[SHARE IMAGE] Echec de generation de l'image de partage: ${error.message}`);
    return seller.profilePicture || 'https://download-yely.vercel.app/logo.png';
  }
};

const renderShareHtml = async (res, seller) => {
  const ogImageUrl = await getShareImageUrl(seller);
  const shopTitle = `Boutique de ${seller.name}`;
  const shopDescription = `Découvrez ma boutique sur Yély. Commandez mes articles en direct et bénéficiez d'une livraison rapide.`;
  const shareUrl = `https://download-yely.vercel.app/shop/${seller.shopSlug || seller._id}`;
  const cloudName = cloudinary.config().cloud_name || 'dpxslyr71';

  res.setHeader('Content-Type', 'text/html');
  return res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${shopTitle}</title>
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="profile">
  <meta property="og:title" content="${shopTitle}">
  <meta property="og:description" content="${shopDescription}">
  <meta property="og:image" content="${ogImageUrl}">
  <meta property="og:image:width" content="500">
  <meta property="og:image:height" content="500">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:url" content="${shareUrl}">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${shopTitle}">
  <meta name="twitter:description" content="${shopDescription}">
  <meta name="twitter:image" content="${ogImageUrl}">

  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --primary: #D4AF37;
      --bg: #050505;
      --card-bg: rgba(20, 20, 20, 0.6);
      --border: rgba(212, 175, 55, 0.2);
      --text: #ffffff;
      --text-muted: rgba(255, 255, 255, 0.6);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      overflow-x: hidden;
      background-image: radial-gradient(circle at 50% 30%, rgba(212, 175, 55, 0.08), transparent 60%);
    }
    
    .container {
      width: 100%;
      max-width: 400px;
      padding: 35px 25px;
      border-radius: 28px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    
    .avatar-wrapper {
      position: relative;
      margin-bottom: 20px;
    }
    
    .logo-img {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      border: 2.5px solid var(--primary);
      object-fit: cover;
      box-shadow: 0 8px 24px rgba(212, 175, 55, 0.25);
    }
    
    .badge-icon {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background: #000;
      border-radius: 50%;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 24px;
      font-weight: 900;
      color: #fff;
      margin-bottom: 6px;
      letter-spacing: -0.5px;
    }
    
    .rating-badge {
      display: flex;
      align-items: center;
      background: rgba(212, 175, 55, 0.1);
      border: 1px solid rgba(212, 175, 55, 0.2);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 13px;
      color: var(--primary);
      font-weight: 600;
      margin-bottom: 20px;
    }
    
    .rating-badge span {
      margin-right: 4px;
    }
    
    p {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 30px;
      max-width: 90%;
    }
    
    .btn-group {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 13px 20px;
      border-radius: 18px;
      font-family: 'Outfit', sans-serif;
      text-decoration: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
      border: none;
      gap: 2px;
    }
    
    .btn-title {
      font-weight: 900;
      font-size: 15.5px;
      letter-spacing: -0.2px;
    }
    
    .btn-subtitle {
      font-family: 'Inter', sans-serif;
      font-size: 10.5px;
      font-weight: 500;
      opacity: 0.85;
    }
    
    .btn-primary {
      background-color: var(--primary);
      color: #000000;
      box-shadow: 0 6px 20px rgba(212, 175, 55, 0.25);
    }
    
    .btn-primary:hover {
      background-color: #f1c40f;
      transform: translateY(-2px);
      box-shadow: 0 8px 25px rgba(212, 175, 55, 0.35);
    }
    
    .btn-primary:active {
      transform: translateY(0);
    }
    
    .btn-secondary {
      background-color: rgba(255, 255, 255, 0.04);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .btn-secondary:hover {
      background-color: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }
    
    .btn-secondary:active {
      transform: translateY(0);
    }
    
    .btn-text {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      text-decoration: underline;
      margin-top: 15px;
      cursor: pointer;
      transition: color 0.2s;
    }
    
    .btn-text:hover {
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="avatar-wrapper">
      <img class="logo-img" src="${seller.profilePicture || 'https://res.cloudinary.com/' + cloudName + '/image/upload/v1/yely/assets/yely_default_storefront'}" alt="Boutique" />
      <div class="badge-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M23 12L20.56 9.22L20.9 5.54L17.29 4.72L15 1.4L11.5 2.92L8 1.4L5.71 4.72L2.1 5.54L2.44 9.22L0 12L2.44 14.78L2.1 18.46L5.71 19.28L8 22.6L11.5 21.08L15 22.6L17.29 19.28L20.9 18.46L20.56 14.78L23 12ZM10 17L6 13L7.41 11.59L10 14.17L16.59 7.58L18 9L10 17Z" fill="#D4AF37"/>
        </svg>
      </div>
    </div>
    
    <h1>${seller.name}</h1>
    
    <div class="rating-badge">
      <span>★</span> ${seller.rating ? seller.rating.toFixed(1) : '5.0'} / 5.0
    </div>
    
    <p>Bienvenue sur Yély ! Choisissez comment vous souhaitez visiter cette boutique.</p>
    
    <div class="btn-group">
      <button id="open-app-btn" class="btn btn-primary">
        <span class="btn-title">Ouvrir dans l'application</span>
        <span class="btn-subtitle">Si Yély est installée sur votre mobile</span>
      </button>
      <a href="https://yely-amber.vercel.app/store/${seller.shopSlug || seller._id}" class="btn btn-secondary">
        <span class="btn-title">Continuer sur le site internet</span>
        <span class="btn-subtitle">Pour visiter la boutique sans rien installer</span>
      </a>
      <a href="https://download-yely.vercel.app" class="btn btn-text" style="display: flex; flex-direction: column; align-items: center; text-decoration: none; gap: 4px; margin-top: 10px;">
        <span style="font-weight: 800; font-family: 'Outfit', sans-serif; font-size: 14.5px; text-decoration: underline; color: var(--primary);">Installer l'application Yély</span>
        <span style="font-size: 10.5px; color: var(--text-muted); font-weight: normal; text-decoration: none;">Pour commander et suivre vos livraisons facilement</span>
      </a>
    </div>
  </div>

  <script>
    document.getElementById('open-app-btn').addEventListener('click', function() {
      var isAndroid = /Android/i.test(navigator.userAgent);
      var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      
      var sellerId = "${seller._id}";
      var shopSlug = "${seller.shopSlug}" || sellerId;
      var appUrl = "yely://store/" + shopSlug;
      var intentUrl = "intent://store/" + shopSlug + "#Intent;scheme=yely;package=com.yely.app;S.browser_fallback_url=https%3A%2F%2Fdownload-yely.vercel.app;end";
      var fallbackUrl = "https://download-yely.vercel.app";
      var pwaUrl = "https://yely-amber.vercel.app/store/" + shopSlug;

      if (isAndroid || isIOS) {
        var start = Date.now();
        var timeout = setTimeout(function() {
          if (!document.hidden && !document.webkitHidden && (Date.now() - start < 2500)) {
            window.location.href = fallbackUrl;
          }
        }, 2000);
        window.location.href = appUrl;
      } else {
        // Desktop ou autre : on ouvre la PWA directement
        window.location.href = pwaUrl;
      }
    });
  </script>
</body>
</html>
  `);
};

const shareSellerShop = async (req, res, next) => {
  try {
    const sellerId = req.params.id;
    const seller = await User.findOne({ _id: sellerId, role: 'seller', isBanned: false, isDeleted: false });
    if (!seller) {
      throw new AppError('Boutique introuvable ou inactive', 404);
    }
    await getOrCreateSellerSlug(seller);
    return renderShareHtml(res, seller);
  } catch (error) {
    return next(error);
  }
};

const shareSellerShopBySlug = async (req, res, next) => {
  try {
    const slug = req.params.slug;
    let query = { role: 'seller', isBanned: false, isDeleted: false };
    
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(slug)) {
      query._id = slug;
    } else {
      query.shopSlug = slug;
    }
    
    const seller = await User.findOne(query);
    if (!seller) {
      throw new AppError('Boutique introuvable ou inactive', 404);
    }
    await getOrCreateSellerSlug(seller);
    return renderShareHtml(res, seller);
  } catch (error) {
    return next(error);
  }
};

module.exports = { 
  getProfile, 
  updateProfile, 
  uploadProfilePicture,
  deleteAccount,
  updateAvailability,
  getSellers,
  getSellerProfile,
  shareSellerShop,
  shareSellerShopBySlug
};