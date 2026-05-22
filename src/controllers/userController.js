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

const shareSellerShop = async (req, res, next) => {
  try {
    const sellerId = req.params.id;
    res.setHeader('Content-Type', 'text/html');
    return res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Boutique Yély</title>
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
    }
    h1 {
      color: #D4AF37;
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
      var webUrl = "https://yely.io/seller/${sellerId}";
      
      window.location.href = appUrl;
      
      setTimeout(function() {
        var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = fallbackUrl;
        } else {
          window.location.href = webUrl;
        }
      }, 2000);
    };
  </script>
</head>
<body>
  <div class="container">
    <h1>Boutique Yély</h1>
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