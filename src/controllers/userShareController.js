// src/controllers/userShareController.js
// CONTROLEUR DE PARTAGE UTILISATEUR - Génération d'images OG Dynamiques et deep linking
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const User = require('../models/User');
const AppError = require('../utils/AppError');
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

const { renderShareHtml } = require('../utils/shopShareTemplate');

const shareSellerShop = async (req, res, next) => {
  try {
    const sellerId = req.params.id;
    const seller = await User.findOne({ _id: sellerId, role: 'seller', isBanned: false, isDeleted: false });
    if (!seller) {
      throw new AppError('Boutique introuvable ou inactive', 404);
    }
    await getOrCreateSellerSlug(seller);
    return renderShareHtml(res, seller, req.headers['user-agent'] || '');
  } catch (error) {
    return next(error);
  }
};

const shareSellerShopBySlug = async (req, res, next) => {
  try {
    const slug = req.params.slug;
    let query = { role: 'seller', isBanned: false, isDeleted: false };
    
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
    return renderShareHtml(res, seller, req.headers['user-agent'] || '');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getOrCreateSellerSlug,
  shareSellerShop,
  shareSellerShopBySlug
};
