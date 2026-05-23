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
    const seller = await User.findOne({ _id: req.params.id, role: 'seller', isBanned: false, isDeleted: false }).select('name profilePicture rating email phone');
    if (!seller) {
      throw new AppError('Vendeur introuvable', 404);
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

// Helper pour générer l'image Open Graph avec overlays
const getShareImageUrl = async (seller) => {
  try {
    const logoLocalPath = path.resolve(__dirname, '../../../YELY/assets/logo.png');
    const logoPublicId = 'yely_logo_overlay';
    const badgePublicId = 'yely_verified_badge_overlay';
    
    // Tentative d'upload du logo s'il existe et n'est pas encore présent
    if (fs.existsSync(logoLocalPath)) {
      await cloudinary.uploader.upload(logoLocalPath, {
        public_id: logoPublicId,
        overwrite: false,
        folder: 'yely/assets'
      }).catch(err => logger.debug(`[CLOUDINARY] Logo déjà présent ou erreur: ${err.message}`));
    }
    
    // SVG du badge de certification
    const badgeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="200" height="200">
  <path d="M23,12L20.56,9.22L20.9,5.54L17.29,4.72L15.4,1.54L12,3L8.6,1.54L6.71,4.72L3.1,5.53L3.44,9.21L1,12L3.44,14.78L3.1,18.47L6.71,19.29L8.6,22.47L12,21L15.4,22.46L17.29,19.28L20.9,18.46L20.56,14.78L23,12M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z" fill="#D4AF37" />
</svg>`;
    const badgeBase64 = `data:image/svg+xml;base64,${Buffer.from(badgeSvg.trim()).toString('base64')}`;
    
    await cloudinary.uploader.upload(badgeBase64, {
      public_id: badgePublicId,
      overwrite: false,
      folder: 'yely/assets'
    }).catch(err => logger.debug(`[CLOUDINARY] Badge déjà présent ou erreur: ${err.message}`));
    
    let baseImageUrl = seller.profilePicture;
    if (!baseImageUrl) {
      const defaultStoreSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400">
  <rect width="100" height="100" fill="#F5D142" />
  <circle cx="50" cy="50" r="45" fill="#000000" opacity="0.05" />
  <path d="M20 20.01L5 34v4h90v-4L80 20.01H20zm0 8.38l10.8 8.38H13.2L20 28.39zM8 44v4h84v-4H8zm4 8v20c0 2.2 1.8 4 4 4h68c2.2 0 4-1.8 4-4V52H12zm16 8h40v12H28V60z" fill="#000000" transform="scale(0.8) translate(12, 12)" />
</svg>`;
      const defaultStoreBase64 = `data:image/svg+xml;base64,${Buffer.from(defaultStoreSvg.trim()).toString('base64')}`;
      const defaultStoreUpload = await cloudinary.uploader.upload(defaultStoreBase64, {
        public_id: 'yely_default_storefront',
        overwrite: false,
        folder: 'yely/assets'
      }).catch(() => null);
      
      baseImageUrl = defaultStoreUpload?.secure_url || 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    }
    
    const encodedBaseUrl = encodeURIComponent(baseImageUrl);
    const cloudName = cloudinary.config().cloud_name;
    return `https://res.cloudinary.com/${cloudName}/image/fetch/c_fill,g_face,w_500,h_500/l_yely:assets:yely_logo_overlay,g_south_east,w_120,x_15,y_15/l_yely:assets:yely_verified_badge_overlay,g_south_west,w_100,x_15,y_15/${encodedBaseUrl}`;
  } catch (error) {
    logger.error(`[SHARE IMAGE] Echec de generation de l'image de partage: ${error.message}`);
    return seller.profilePicture || 'https://download-yely.vercel.app/logo.png';
  }
};

const shareSellerShop = async (req, res, next) => {
  try {
    const sellerId = req.params.id;
    const seller = await User.findOne({ _id: sellerId, role: 'seller', isBanned: false, isDeleted: false });
    if (!seller) {
      throw new AppError('Boutique introuvable ou inactive', 404);
    }
    
    const ogImageUrl = await getShareImageUrl(seller);
    const shopTitle = `Boutique de ${seller.name}`;
    const shopDescription = `Découvrez ma boutique sur Yély. Commandez mes articles en direct et bénéficiez d'une livraison rapide.`;

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
  <meta property="og:url" content="https://yely-backend-yzw4.onrender.com/api/v1/users/sellers/${sellerId}/share">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${shopTitle}">
  <meta name="twitter:description" content="${shopDescription}">
  <meta name="twitter:image" content="${ogImageUrl}">

  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      background-color: #0b0b0b;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
      text-align: center;
    }
    .container {
      max-width: 400px;
      padding: 30px;
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(212, 175, 55, 0.2);
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .logo-img {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      border: 2px solid #D4AF37;
      margin-bottom: 20px;
      object-fit: cover;
    }
    h1 {
      color: #D4AF37;
      margin-top: 0;
      margin-bottom: 10px;
      font-size: 24px;
    }
    p {
      color: rgba(255,255,255,0.7);
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 25px;
    }
    .btn {
      display: inline-block;
      background-color: #D4AF37;
      color: #000000;
      text-decoration: none;
      padding: 12px 30px;
      border-radius: 30px;
      font-weight: bold;
      font-size: 15px;
      transition: background-color 0.2s;
    }
    .btn:hover {
      background-color: #f1c40f;
    }
  </style>
  <script>
    window.onload = function() {
      var appUrl = "yely://seller/${sellerId}";
      var fallbackUrl = "https://download-yely.vercel.app";
      
      window.location.href = appUrl;
      
      setTimeout(function() {
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = fallbackUrl;
        } else {
          window.location.href = fallbackUrl;
        }
      }, 1500);
    };
  </script>
</head>
<body>
  <div class="container">
    <img class="logo-img" src="${seller.profilePicture || 'https://res.cloudinary.com/' + cloudinary.config().cloud_name + '/image/upload/v1/yely/assets/yely_default_storefront'}" alt="Boutique" />
    <h1>${seller.name}</h1>
    <p>Redirection en cours vers la boutique...</p>
    <a class="btn" href="https://download-yely.vercel.app">Télécharger Yély</a>
  </div>
</body>
</html>
    `);
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
  shareSellerShop
};