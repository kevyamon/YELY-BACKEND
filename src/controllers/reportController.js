// src/controllers/reportController.js
const Report = require('../models/Report');
const User = require('../models/User'); 
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { successResponse, errorResponse } = require('../utils/responseHandler');
const notificationService = require('../services/notificationService'); 

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

    const io = req.app.get('socketio');
    if (io) {
      // CORRECTION SENIOR : Ciblage exclusif de la salle admins
      io.to('admins').emit('new_admin_report', report);
    }

    try {
      const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } });
      for (const adminUser of admins) {
        await notificationService.sendNotification(
          adminUser._id,
          "Nouveau Signalement",
          "Un utilisateur a soumis un nouveau probleme necessitant votre attention.",
          "NEW_REPORT",
          { reportId: report._id.toString() }
        );
      }
    } catch (notifErr) {
      console.error("[NOTIF_ERROR] Echec de l'envoi du push aux admins:", notifErr.message);
    }

    return successResponse(res, report, 'Votre signalement a ete transmis a l\'administration.', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getMyReports = async (req, res) => {
  const reports = await Report.find({ user: req.user._id, deletedByUser: false }).sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const getAllReports = async (req, res) => {
  const reports = await Report.find({ deletedByAdmin: false }).populate('user', 'name phone email').sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const resolveReport = async (req, res) => {
  const { note } = req.body;
  const report = await Report.findByIdAndUpdate(req.params.id, { 
    status: 'RESOLVED', 
    adminNote: note 
  }, { new: true });

  if (report) {
    await notificationService.sendNotification(
      report.user,
      "Signalement Resolu",
      "L'equipe a repondu a votre signalement. Touchez ici pour lire la reponse.",
      "REPORT_RESOLVED",
      { reportId: report._id.toString() }
    );

    const io = req.app.get('socketio');
    if (io) {
      io.to(report.user.toString()).emit('report_resolved', report);
      // CORRECTION SENIOR : Synchronisation inter-admins
      io.to('admins').emit('admin_report_updated', report);
    }
  }

  return successResponse(res, report, 'Signalement marque comme resolu.');
};

const deleteReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return errorResponse(res, "Signalement introuvable.", 404);

    report.deletedByAdmin = true; 

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
      await report.save(); 
    }

    const io = req.app.get('socketio');
    if (io) {
      // CORRECTION SENIOR : Informe les autres admins pour vider leur dashboard en temps reel
      io.to('admins').emit('admin_report_deleted', req.params.id);
    }

    return successResponse(res, null, 'Signalement supprime de votre tableau de bord.');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const deleteMyReport = async (req, res) => {
  try {
    const report = await Report.findOne({ _id: req.params.id, user: req.user._id });
    if (!report) return errorResponse(res, "Signalement introuvable.", 404);

    report.deletedByUser = true; 

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
      await report.save(); 
    }

    return successResponse(res, null, 'Signalement retire de votre historique.');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { submitReport, getMyReports, getAllReports, resolveReport, deleteReport, deleteMyReport };