require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const session = require('express-session');
const axios = require('axios'); // For downloading images

const app = express();
const PORT = process.env.PORT || 4000;

// Admin credentials from environment variables
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_this_password';

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Ensure images directory exists
const imagesDir = path.join(__dirname, 'images');
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir);
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

app.use(cors({
  origin: true,
  credentials: true
}));
app.use('/uploads', express.static(uploadsDir));
app.use('/images', express.static(imagesDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: false } // set secure: true if using HTTPS
}));

// In-memory KML metadata
let kmlMetadata = [];

// Load helicopter metadata from JSON file
let helicopterMetadata = {};
function loadHelicopterMetadata() {
  try {
    const helicopterDataPath = path.join(__dirname, 'helicopters.json');
    if (fs.existsSync(helicopterDataPath)) {
      helicopterMetadata = JSON.parse(fs.readFileSync(helicopterDataPath, 'utf8'));
      console.log(`✅ Loaded metadata for ${Object.keys(helicopterMetadata).length} helicopters`);
    } else {
      console.log('⚠️ helicopters.json not found');
    }
  } catch (e) {
    console.log('❌ Error loading helicopter metadata:', e.message);
  }
}

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
    // Extract image URL and owner from description (HTML)
    let imageUrl = '';
    let owner = '';
    if (doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      // Extract image URL
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) imageUrl = imgMatch[1];
      // Extract owner: find first <div ...>...</div>, then text after <br/>
      const divMatch = desc.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
      if (divMatch) {
        const divContent = divMatch[1];
        const brSplit = divContent.split(/<br\/?\s*>/i);
        if (brSplit.length > 1) {
          owner = brSplit[1].replace(/<[^>]+>/g, '').trim();
        }
      }
    }
    // Debug log for each file
    console.log(`[KML DEBUG] ${filename}: registration=${registration}, date=${date}, time=${time}, imageUrl=${imageUrl}, owner=${owner}`);
    return { filename, registration, date, time, imageUrl, owner };
  } catch (e) {
    console.log(`[KML ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '', imageUrl: '', owner: '' };
  }
}

// Helper to download and cache image
async function cacheImage(imageUrl, registration) {
  if (!imageUrl || !registration) return '';
  const ext = path.extname(imageUrl).split('?')[0] || '.jpg';
  const localName = registration.replace(/[^A-Z0-9-]/gi, '_') + ext;
  const localPath = path.join(imagesDir, localName);
  const publicPath = `/images/${localName}`;
  if (fs.existsSync(localPath)) return publicPath;
  try {
    const response = await axios.get(imageUrl, { responseType: 'stream', timeout: 10000 });
    await new Promise((resolve, reject) => {
      const stream = response.data.pipe(fs.createWriteStream(localPath));
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    return publicPath;
  } catch (e) {
    console.log(`[IMAGE CACHE ERROR] Failed to download ${imageUrl}:`, e.message);
    return '';
  }
}

function scanKmlMetadata() {
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  kmlMetadata = files.map((filename, idx) => {
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfoFromFile(filePath, filename);
    
    // Only return basic flight data - helicopter metadata comes from helicopters.json
    return {
      filename: meta.filename,
      registration: meta.registration,
      date: meta.date,
      time: meta.time
    };
  }).filter(meta => meta.registration); // Only include flights with valid registration
}

// Initial scan on startup
scanKmlMetadata();
loadHelicopterMetadata();

// Middleware to check admin authentication
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Admin login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// Admin logout endpoint
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post('/upload', requireAdmin, upload.single('kml'), async (req, res) => {
  if (!req.file) {
    return res.status(409).json({ error: 'File already exists' });
  }
  // After upload, extract imageUrl and registration, cache image
  const meta = extractKmlInfoFromFile(req.file.path, req.file.originalname);
  if (meta.imageUrl && meta.registration) {
    meta.imageUrl = await cacheImage(meta.imageUrl, meta.registration);
  }
  res.json({
    filename: req.file.originalname,
    originalname: req.file.originalname,
    url: `/uploads/${req.file.originalname}`,
    imageUrl: meta.imageUrl || '',
    owner: meta.owner || ''
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
  // Merge flight data with helicopter metadata
  const enrichedMetadata = kmlMetadata.map(flight => {
    const heliData = helicopterMetadata[flight.registration] || {};
    return {
      ...flight,
      owner: heliData.owner || '',
      imageUrl: heliData.imageUrl || ''
    };
  });
  res.json(enrichedMetadata);
});

// Endpoint to refresh KML metadata (admin only)
app.post('/refresh-metadata', requireAdmin, (req, res) => {
  scanKmlMetadata();
  res.json({ success: true, count: kmlMetadata.length });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    flights: kmlMetadata.length,
    helicopters: Object.keys(helicopterMetadata).length
  });
});

// Serve static files from the Vite build (../dist)
app.use(express.static(path.join(__dirname, '../dist')));

// Fallback for SPA (serves index.html for any unknown route)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
}); 