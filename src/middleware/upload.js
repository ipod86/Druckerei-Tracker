'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadPath = path.resolve(process.env.UPLOAD_PATH || './uploads');
const attachmentsPath = path.join(uploadPath, 'attachments');

if (!fs.existsSync(attachmentsPath)) {
  fs.mkdirSync(attachmentsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, attachmentsPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${sanitized}`);
  }
});

const allowedMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const uploadConfig = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const uploadSingle = uploadConfig.single('file');
const uploadMultiple = uploadConfig.array('files', 20);

module.exports = { uploadSingle, uploadMultiple };
