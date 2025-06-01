require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const session = require('express-session');
const axios = require('axios'); // For downloading images
const SmartKMLManager = require('./smart-kml-manager.cjs');

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
    let imageUrl = '';
    let owner = '';
    
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
    
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    
    // Handle case where KML doesn't have Document wrapper (ADS-B Exchange)
    const kmlRoot = doc || xml.kml;
    
    // Determine KML source and extract accordingly
    const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
    const isAdsb = filename.includes('track') || (!doc && xml.kml.Folder);
    
    console.log(`[KML SOURCE] ${filename}: ${isFlightRadar24 ? 'FlightRadar24' : isAdsb ? 'ADS-B Exchange' : 'Unknown'}`);
    
    if (isFlightRadar24) {
      // FlightRadar24 format parsing
      if (doc.name) {
        // Handle formats like "-/ZSHMB" or "FlightRadar24/ZSHMB"
        const regMatch = doc.name.match(/[A-Z]{2}[A-Z0-9]{3}$/);
        if (regMatch) {
          const rawReg = regMatch[0]; // e.g., "ZSHMB"
          // Convert to proper format: ZSHMB -> ZS-HMB
          registration = rawReg.slice(0, 2) + '-' + rawReg.slice(2);
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
      
      // Extract image URL and owner from description (HTML)
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
    } else if (isAdsb) {
      // ADS-B Exchange format parsing
      // First try to find registration in Placemark names (use kmlRoot instead of doc)
      if (kmlRoot && kmlRoot.Folder) {
        // Handle nested Folder structure (ADS-B Exchange has Folder.Folder)
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          // Nested folder structure (xml.kml.Folder.Folder)
          if (Array.isArray(kmlRoot.Folder.Folder)) {
            foldersToSearch = kmlRoot.Folder.Folder;
          } else {
            foldersToSearch = [kmlRoot.Folder.Folder];
          }
        } else {
          // Direct folder structure with numeric keys
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              if (pm.name) {
                // Look for registration pattern like "ZS-HMB"
                const regMatch = pm.name.match(/^([A-Z0-9]{2}-[A-Z0-9]{2,3})$/);
                if (regMatch) {
                  registration = regMatch[1];
                  console.log(`[KML REGEX] Matched registration in Placemark name: ${registration}`);
                  break;
                }
              }
            }
            if (registration) break;
          }
        }
      }
      
      // Fallback: try filename if not found in content
      if (!registration) {
        const fileRegMatch = filename.match(/^([A-Z0-9]{2}-[A-Z0-9]{3})/);
        if (fileRegMatch) {
          registration = fileRegMatch[1];
          console.log(`[KML REGEX] Matched registration in filename: ${registration}`);
        }
      }
      
      // For ADS-B Exchange, we don't have owner/image data in the KML
      // These will need to come from helicopters.json lookup
      owner = '';
      imageUrl = '';
    }
    
    // Date/Time extraction (same for both formats)
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
    
    // Try to find TimeStamp when elements (common in ADS-B Exchange)
    if ((!date || !time) && kmlRoot && kmlRoot.Folder) {
      // Handle nested Folder structure (ADS-B Exchange has Folder.Folder)
      let foldersToSearch = [];
      
      if (kmlRoot.Folder.Folder) {
        // Nested folder structure (xml.kml.Folder.Folder)
        if (Array.isArray(kmlRoot.Folder.Folder)) {
          foldersToSearch = kmlRoot.Folder.Folder;
        } else {
          foldersToSearch = [kmlRoot.Folder.Folder];
        }
      } else {
        // Direct folder structure with numeric keys
        const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
        foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
      }
      
      for (const folder of foldersToSearch) {
        if (folder.Placemark) {
          const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
          for (const pm of placemarks) {
            // Check for TimeStamp when elements
            if (pm.TimeStamp && pm.TimeStamp.when) {
              // Parse ISO format: "2025-05-18T08:37:34.130Z"
              const whenMatch = pm.TimeStamp.when.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
              if (whenMatch) {
                date = whenMatch[1];
                time = whenMatch[2];
                console.log(`[KML REGEX] Matched date/time in TimeStamp when: ${date} ${time}`);
                break;
              }
            }
            // Check for gx:Track when elements (ADS-B Exchange format)
            if (pm['gx:Track'] && pm['gx:Track'].when) {
              const whenElements = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
              if (whenElements.length > 0) {
                const firstWhen = whenElements[0];
                const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
                if (whenMatch) {
                  date = whenMatch[1];
                  time = whenMatch[2];
                  console.log(`[KML REGEX] Matched date/time in gx:Track when: ${date} ${time}`);
                  break;
                }
              }
            }
          }
          if (date && time) break;
        }
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

async function scanKmlMetadata() {
  // First, process any new files with the smart manager
  console.log('🧠 Running Smart KML Manager...');
  const manager = new SmartKMLManager();
  try {
    const results = await manager.processNewFiles();
    if (results.processed > 0) {
      console.log(`✨ Smart Manager processed ${results.processed} new files, renamed ${results.renamed}, found ${results.duplicates} duplicates`);
    }
  } catch (error) {
    console.log(`⚠️ Smart Manager error: ${error.message}`);
  }

  // Then load from cache
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      console.log(`📋 Loaded ${cached.length} flights from cache`);
      
      // Verify cache is still valid by checking file count
      const currentFiles = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
      if (cached.length === currentFiles.length) {
        kmlMetadata = cached.map(flight => ({
          filename: flight.filename,
          registration: flight.registration,
          date: flight.date,
          time: flight.time
        }));
        console.log(`✅ Cache is up to date with ${currentFiles.length} files`);
        return;
      } else {
        console.log(`⚠️ Cache outdated: ${cached.length} cached vs ${currentFiles.length} files. Rescanning...`);
      }
    } catch (e) {
      console.log(`❌ Error reading cache: ${e.message}. Rescanning...`);
    }
  }
  
  // Fallback: scan all files (original behavior)
  console.log(`🔍 Scanning all KML files...`);
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  kmlMetadata = files.map((filename, idx) => {
    if (idx % 50 === 0) console.log(`Processing file ${idx + 1}/${files.length}...`);
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
  
  // Save to cache for next time
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(kmlMetadata, null, 2));
    console.log(`💾 Saved ${kmlMetadata.length} flights to cache`);
  } catch (e) {
    console.log(`❌ Error saving cache: ${e.message}`);
  }
}

// Initial scan on startup (make it async)
(async () => {
  await scanKmlMetadata();
  loadHelicopterMetadata();
})();

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
  
  // Invalidate cache and add new file to metadata
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
      console.log(`🗑️ Invalidated cache after new upload: ${req.file.originalname}`);
    } catch (e) {
      console.log(`❌ Error deleting cache: ${e.message}`);
    }
  }
  
  // Add to current metadata immediately
  if (meta.registration) {
    kmlMetadata.push({
      filename: meta.filename,
      registration: meta.registration,
      date: meta.date,
      time: meta.time
    });
    console.log(`✅ Added ${meta.registration} to metadata`);
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
  // Force full rescan by deleting cache
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
      console.log(`🗑️ Deleted cache for full rescan`);
    } catch (e) {
      console.log(`❌ Error deleting cache: ${e.message}`);
    }
  }
  
  scanKmlMetadata();
  res.json({ success: true, count: kmlMetadata.length });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  const isReady = kmlMetadata.length > 0 && Object.keys(helicopterMetadata).length > 0;
  
  if (isReady) {
    res.status(200).json({ 
      status: 'ok', 
      ready: true,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      flights: kmlMetadata.length,
      helicopters: Object.keys(helicopterMetadata).length,
      memory: process.memoryUsage(),
      version: process.version
    });
  } else {
    res.status(503).json({
      status: 'starting',
      ready: false,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      flights: kmlMetadata.length,
      helicopters: Object.keys(helicopterMetadata).length,
      message: 'Application is still loading data...'
    });
  }
});

// Readiness probe endpoint (alternative for Render)
app.get('/ready', (req, res) => {
  const isReady = kmlMetadata.length > 0;
  if (isReady) {
    res.status(200).send('OK');
  } else {
    res.status(503).send('Not Ready');
  }
});

// Hot reload endpoint - reload metadata without restart
app.post('/hot-reload', (req, res) => {
  console.log('🔄 Hot reloading metadata...');
  
  // Get current file count
  const currentFiles = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  const currentCount = currentFiles.length;
  const cacheCount = kmlMetadata.length;
  
  if (currentCount === cacheCount) {
    console.log(`✅ No new files detected (${currentCount} files)`);
    return res.json({ 
      success: true, 
      message: 'No new files to process',
      flights: currentCount 
    });
  }
  
  console.log(`📊 Detected ${currentCount - cacheCount} new files (${cacheCount} → ${currentCount})`);
  
  // Force cache reload for new files only
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }
  
  // Reload metadata
  scanKmlMetadata().then(() => {
    console.log(`✅ Hot reload complete: ${kmlMetadata.length} total flights`);
    res.json({ 
      success: true, 
      oldCount: cacheCount,
      newCount: kmlMetadata.length,
      added: kmlMetadata.length - cacheCount
    });
  }).catch(error => {
    console.error('❌ Hot reload error:', error);
    res.status(500).json({ error: error.message });
  });
});

// Serve static files from the Vite build (../dist)
app.use(express.static(path.join(__dirname, '../dist')));

// Fallback for SPA (serves index.html for any unknown route)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// Start server immediately, then process files in background
const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  
  // Process KML files in background after server starts
  setTimeout(async () => {
    await scanKmlMetadata();
  }, 100);
});