// src/controllers/reportController.js
const Report = require('../models/Report');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const submitReport = async (req, res) => {
  try {
    const { message } = req.body;
    const captures = [];

    if (req.files) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, { folder: 'yely/reports' });
        captures.push(result.secure_url);
        fs.unlinkSync(file.path);
      }
    }

    const report = await Report.create({
      user: req.user._id,
      message: message.substring(0, 2000), // Anti-injection brute
      captures
    });

    return successResponse(res, report, 'Votre signalement a été transmis à l\'administration.', 201);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

const getMyReports = async (req, res) => {
  const reports = await Report.find({ user: req.user._id }).sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const getAllReports = async (req, res) => {
  const reports = await Report.find().populate('user', 'name phone email').sort({ createdAt: -1 });
  return successResponse(res, reports);
};

const resolveReport = async (req, res) => {
  const { note } = req.body;
  const report = await Report.findByIdAndUpdate(req.params.id, { 
    status: 'RESOLVED', 
    adminNote: note 
  }, { new: true });
  return successResponse(res, report, 'Signalement marqué comme résolu.');
};

module.exports = { submitReport, getMyReports, getAllReports, resolveReport };