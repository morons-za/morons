const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    const overwrite = req.body.overwrite === 'true';
    const filePath = path.join(uploadsDir, file.originalname);
    if (fs.existsSync(filePath) && !overwrite) {
      return cb(new Error('File already exists'), false);
    }
    cb(null, true);
  }
});

app.use(cors());
app.use('/uploads', express.static(uploadsDir));
app.use(express.urlencoded({ extended: true }));

app.post('/upload', upload.single('kml'), (req, res) => {
  if (!req.file) {
    return res.status(409).json({ error: 'File already exists' });
  }
  res.json({
    filename: req.file.originalname,
    originalname: req.file.originalname,
    url: `/uploads/${req.file.originalname}`
  });
});

app.get('/uploads', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Unable to list uploads' });
    }
    // Only return .kml files
    const kmlFiles = files.filter(f => f.toLowerCase().endsWith('.kml'));
    res.json(kmlFiles.map(filename => ({
      filename,
      url: `/uploads/${filename}`
    })));
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 