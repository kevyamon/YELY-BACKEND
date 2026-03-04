// src/controllers/reportController.js
const Report = require('../models/Report');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const notificationService = require('../services/notificationService'); // AJOUT SENIOR: Pour les notifs

const submitReport = async (req, res) => {
  try {
    const { message } = req.body;
    const captures = [];

    if (req.files) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, { folder: 'yely/reports' });
        captures.push(result.secure_url);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    const report = await Report.create({
      user: req.user._id,
      message: message.substring(0, 2000),
      captures
    });

    // CORRECTION SENIOR: Utilisation du bon nom de variable 'socketio' au lieu de 'io'
    const io = req.app.get('socketio');
    if (io) {
      // On envoie spécifiquement dans la salle 'admin' si on l'a configurée, sinon on broadcast
      io.emit('new_admin_report', report);
    }

    return successResponse(res, report, 'Votre signalement a été transmis à l\'administration.', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getMyReports = async (req, res) => {
  // AJOUT SENIOR: On cache ceux que l'utilisateur a supprimés
  const reports = await Report.find({ user: req.user._id, deletedByUser: false }).sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const getAllReports = async (req, res) => {
  // AJOUT SENIOR: On cache ceux que l'admin a supprimés
  const reports = await Report.find({ deletedByAdmin: false }).populate('user', 'name phone email').sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const resolveReport = async (req, res) => {
  const { note } = req.body;
  const report = await Report.findByIdAndUpdate(req.params.id, { 
    status: 'RESOLVED', 
    adminNote: note 
  }, { new: true });

  // AJOUT SENIOR: Envoi de la notification Push + In-App au plaintif
  if (report) {
    await notificationService.sendNotification(
      report.user,
      "Signalement Résolu ✅",
      "L'équipe a répondu à votre signalement. Touchez ici pour lire la réponse.",
      "SYSTEM",
      { reportId: report._id.toString() }
    );

    // CORRECTION SENIOR: Utilisation du bon nom 'socketio'
    const io = req.app.get('socketio');
    if (io) {
      io.to(report.user.toString()).emit('report_resolved', report);
    }
  }

  return successResponse(res, report, 'Signalement marqué comme résolu.');
};

// AJOUT SENIOR : Suppression Intelligente côté Admin
const deleteReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return errorResponse(res, "Signalement introuvable.", 404);

    report.deletedByAdmin = true; // L'admin demande à le cacher

    // Si le plaintif l'avait DEJA supprimé, on détruit tout pour économiser Cloudinary
    if (report.deletedByUser) {
      if (report.captures && report.captures.length > 0) {
        for (const url of report.captures) {
          const publicIdMatch = url.match(/\/v\d+\/([^/.]+)\./);
          if (publicIdMatch && publicIdMatch[1]) {
             await cloudinary.uploader.destroy(`yely/reports/${publicIdMatch[1]}`).catch(() => {});
          }
        }
      }
      await Report.findByIdAndDelete(report._id);
    } else {
      await report.save(); // Sinon on le cache juste pour l'admin
    }

    return successResponse(res, null, 'Signalement supprimé de votre tableau de bord.');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// AJOUT SENIOR : Suppression Intelligente côté Utilisateur
const deleteMyReport = async (req, res) => {
  try {
    const report = await Report.findOne({ _id: req.params.id, user: req.user._id });
    if (!report) return errorResponse(res, "Signalement introuvable.", 404);

    report.deletedByUser = true; // L'utilisateur demande à le cacher

    // Si l'admin l'avait DEJA supprimé, on détruit tout pour économiser Cloudinary
    if (report.deletedByAdmin) {
      if (report.captures && report.captures.length > 0) {
        for (const url of report.captures) {
          const publicIdMatch = url.match(/\/v\d+\/([^/.]+)\./);
          if (publicIdMatch && publicIdMatch[1]) {
             await cloudinary.uploader.destroy(`yely/reports/${publicIdMatch[1]}`).catch(() => {});
          }
        }
      }
      await Report.findByIdAndDelete(report._id);
    } else {
      await report.save(); // Sinon on le cache juste pour l'utilisateur
    }

    return successResponse(res, null, 'Signalement retiré de votre historique.');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { submitReport, getMyReports, getAllReports, resolveReport, deleteReport, deleteMyReport };