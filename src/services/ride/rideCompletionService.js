// src/services/ride/rideCompletionService.js
// SERVICE METIER - Clôture de course, calculs de dettes et ardoises ledger
// STANDARD: Industriel / Bank Grade

const mongoose = require('mongoose');
const Ride = require('../../models/Ride');
const User = require('../../models/User');
const userRepository = require('../../repositories/userRepository');
const poiController = require('../../controllers/poiController'); 
const notificationService = require('../notificationService'); 
const AppError = require('../../utils/AppError');
const logger = require('../../config/logger');
const { calculateHaversineDistance } = require('./rideHelpers');

const completeRideSession = async (driverId, rideId, io) => {
  const session = await mongoose.startSession();
  let result;
  
  try {
    await session.withTransaction(async () => {
      const ride = await Ride.findOne({ _id: rideId, driver: driverId }).session(session);
      
      if (!ride) {
        throw new AppError('Course introuvable ou non assignee a ce chauffeur.', 404);
      }
      
      if (ride.status === 'completed') {
        logger.info(`[IDEMPOTENCE] Course ${rideId} deja cloturee. Renvoi silencieux du succes.`);
        result = ride;
        return; 
      }

      if (ride.status !== 'in_progress') {
        logger.warn(`[SECURITY] Tentative de cloture de course invalide. Status: ${ride.status}`);
        throw new AppError("Action impossible a ce stade de la course.", 403);
      }

      const driver = await User.findById(driverId).session(session);
      if (driver?.currentLocation?.coordinates) {
        const dist = calculateHaversineDistance(
          driver.currentLocation.coordinates,
          ride.destination.coordinates
        );
        if (dist > 0.05) {
          logger.warn(`[SECURITY] Fraude evitee (Complete Ride). Driver: ${driverId}, Dist: ${dist}km`);
          throw new AppError(`Securite : Vous etes trop loin de la destination (${(dist * 1000).toFixed(0)}m). Tolerance : 50m.`, 403);
        }
      }

      ride.status = 'completed';
      ride.completedAt = new Date();
      await ride.save({ session });
      
      await userRepository.updateDriverAvailability(driverId, true, session);
      
      await User.findByIdAndUpdate(driverId, {
        $inc: { 
          totalRides: 1, 
          totalEarnings: ride.price || 0
        }
      }, { session });

      // --- COUPLAGE D'ÉTAT MARKETPLACE (DELIVERED) & RECONCILIATION ---
      if (ride.type === 'DELIVERY' && ride.orderId) {
        const Order = require('../../models/Order');
        const Ledger = require('../../models/Ledger');
        
        const order = await Order.findById(ride.orderId).populate('items.product').session(session);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = Date.now();
          order.driver = ride.driver;
          order.history.push({ status: 'delivered', comment: 'Commande livrée avec succès', timestamp: Date.now() });
          await order.save({ session });

          const sellerAmounts = new Map();
          for (const item of order.items) {
            const sellerId = item.product && item.product.seller
              ? item.product.seller.toString()
              : order.seller.toString();
            
            const itemTotal = item.price * item.quantity;
            sellerAmounts.set(sellerId, (sellerAmounts.get(sellerId) || 0) + itemTotal);
          }

          const ledgerEntries = [];
          for (const [sellerId, amount] of sellerAmounts.entries()) {
            ledgerEntries.push({
              driver: ride.driver,
              seller: sellerId,
              order: order._id,
              amount: amount,
              status: 'pending',
              note: `Création automatique suite à la livraison réussie du Ride ${ride._id} (Montant produit pour ce vendeur)`
            });
          }

          await Ledger.create(ledgerEntries, { session });

          const driverDoc = await User.findById(ride.driver).session(session);
          if (driverDoc) {
            driverDoc.ledger = driverDoc.ledger || {};
            driverDoc.ledger.currentCashDebt = (driverDoc.ledger.currentCashDebt || 0) + order.itemsPrice;
            
            if (driverDoc.ledger.currentCashDebt >= (driverDoc.ledger.maxCashDebt || 100000)) {
              driverDoc.ledger.isBlocked = true;
              logger.warn(`[SECURITY] Livreur ${driverDoc.email} bloqué automatiquement suite à dépassement de la dette maximale.`);
            }
            await driverDoc.save({ session });
          }
        }
      }
      
      result = ride;
    });
  } finally {
    await session.endSession();
  }

  if (result && io) {
    if (result.origin?.address) {
      await poiController.releasePendingPOI(result.origin.address, io);
    }
    if (result.destination?.address) {
      await poiController.releasePendingPOI(result.destination.address, io);
    }

    if (result.type === 'DELIVERY' && result.orderId) {
      try {
        const Order = require('../../models/Order');
        const order = await Order.findById(result.orderId).populate('customer seller driver');
        if (order) {
          io.to(order.customer._id.toString()).emit('order_updated', order);
          io.to(order.seller._id.toString()).emit('order_updated', order);
          
          notificationService.sendNotification(
            order.customer._id, 
            'Livrée ! 🎉', 
            'Votre commande a été livrée. Merci de votre confiance !', 
            'ORDER_COMPLETE', 
            { orderId: order._id.toString() }
          ).catch(() => {});

          notificationService.sendNotification(
            order.seller._id, 
            'Livraison effectuée ! 💰', 
            `Le livreur ${order.driver?.name || 'Yély'} vous doit ${order.itemsPrice} FCFA pour la commande #${order._id.toString().slice(-6)}.`, 
            'ORDER_UPDATE', 
            { orderId: order._id.toString() }
          ).catch(() => {});
        }
      } catch (completeNotifyError) {
        logger.error(`[NOTIFY ERROR] Échec de l'envoi de notification de livraison : ${completeNotifyError.message}`);
      }
    }
  }

  return result;
};

module.exports = {
  completeRideSession
};
