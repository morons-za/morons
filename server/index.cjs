const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 4000;

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

// In-memory KML metadata
let kmlMetadata = [];

function extractKmlInfoFromFile(filePath, filename) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    let registration = '';
    let date = '';
    let time = '';
    // Helper: recursively find first Placemark
    function findFirstPlacemark(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.Placemark) {
        if (Array.isArray(obj.Placemark)) return obj.Placemark[0];
        return obj.Placemark;
      }
      for (const key of Object.keys(obj)) {
        const found = findFirstPlacemark(obj[key]);
        if (found) return found;
      }
      return null;
    }
    // Registration: extract from Document.name (e.g. -/ZTRMS)
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    if (doc && doc.name) {
      // Match last 5 uppercase letters/numbers
      const regMatch = doc.name.match(/[A-Z0-9]{5}$/);
      if (regMatch) {
        // Format as ZT-XXX
        registration = 'ZT-' + regMatch[0].slice(2);
        console.log(`[KML REGEX] Matched registration in name: ${registration}`);
      }
    }
    // Fallback: try to extract from description (as a link)
    if (!registration && doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      let regMatch = desc.match(/Registration<[^>]*>.*?<a [^>]*>([A-Z0-9-]+)<\/a>/i);
      if (regMatch) {
        registration = regMatch[1];
        console.log(`[KML REGEX] Matched registration in description: ${registration}`);
      }
    }
    // Date/Time: try first Placemark name, else look for <span title="YYYY-MM-DD HH:MM">
    let placemark = null;
    if (doc) {
      placemark = findFirstPlacemark(doc);
    }
    if (placemark && placemark.name) {
      const dtMatch = placemark.name.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      if (dtMatch) {
        date = dtMatch[1];
        time = dtMatch[2];
        console.log(`[KML REGEX] Matched date/time in Placemark name: ${date} ${time}`);
      }
    }
    // Fallback: try <span title="YYYY-MM-DD HH:MM"> in description
    if ((!date || !time) && doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      let dtMatch = desc.match(/<span[^>]+title=\"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\">/);
      if (dtMatch) {
        date = dtMatch[1];
        time = dtMatch[2];
        console.log(`[KML REGEX] Matched date/time in description: ${date} ${time}`);
      }
    }
    // Debug log for each file
    console.log(`[KML DEBUG] ${filename}: registration=${registration}, date=${date}, time=${time}`);
    return { filename, registration, date, time };
  } catch (e) {
    console.log(`[KML ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '' };
  }
}

function scanKmlMetadata() {
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  kmlMetadata = files.map((filename, idx) => {
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfoFromFile(filePath, filename);
    if (idx === 0) {
      // Debug: print parsed XML and extracted metadata for the first file
      const xmlData = fs.readFileSync(filePath, 'utf8');
      const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
      const xml = parser.parse(xmlData);
      console.log('--- DEBUG: Parsed XML for', filename, '---');
      console.dir(xml, { depth: 6 });
      console.log('--- DEBUG: Extracted metadata ---');
      console.dir(meta);
    }
    return meta;
  });
}

// Initial scan on startup
scanKmlMetadata();

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

// Endpoint to get KML metadata
app.get('/kml-metadata', (req, res) => {
  res.json(kmlMetadata);
});

// Endpoint to refresh KML metadata (admin only: ?admin=1)
app.post('/refresh-metadata', (req, res) => {
  if (req.query.admin !== '1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  scanKmlMetadata();
  res.json({ success: true, count: kmlMetadata.length });
});

// Serve static files from the Vite build (../dist)
app.use(express.static(path.join(__dirname, '../dist')));

// Fallback for SPA (serves index.html for any unknown route)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 