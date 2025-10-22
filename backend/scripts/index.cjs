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

// Admin credentials from environment variables (required)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Validate required environment variables
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Missing required environment variables:');
  if (!ADMIN_EMAIL) console.error('  - ADMIN_EMAIL');
  if (!ADMIN_PASSWORD) console.error('  - ADMIN_PASSWORD');
  console.error('');
  console.error('📋 Setup Instructions:');
  console.error('1. Copy env.example to .env: cp env.example .env');
  console.error('2. Edit .env with your actual values');
  console.error('3. Generate a secure SESSION_SECRET (32+ characters)');
  console.error('4. Use strong passwords for ADMIN_PASSWORD');
  console.error('');
  console.error('See env.example for all required variables.');
  process.exit(1);
}

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

// Ensure flight-maps directory exists
const flightMapsDir = path.join(__dirname, 'flight-maps');
if (!fs.existsSync(flightMapsDir)) {
  fs.mkdirSync(flightMapsDir);
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
// Redirect uploads to GitHub LFS
app.get('/uploads/:filename', (req, res) => {
  const filename = req.params.filename;
  const githubUrl = `https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/${filename}`;
  
  res.redirect(301, githubUrl);
});

// Redirect flight-maps to GitHub LFS
app.get('/flight-maps/:filename', (req, res) => {
  const filename = req.params.filename;
  const githubUrl = `https://media.githubusercontent.com/media/werneravr/heli-map/main/server/flight-maps/${filename}`;
  
  res.redirect(301, githubUrl);
});
app.use('/images', express.static(imagesDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// Session secret from environment variables (required)
const SESSION_SECRET = process.env.SESSION_SECRET;

// Validate session secret
if (!SESSION_SECRET) {
  console.error('❌ Missing required environment variable: SESSION_SECRET');
  console.error('');
  console.error('📋 Setup Instructions:');
  console.error('1. Copy env.example to .env: cp env.example .env');
  console.error('2. Edit .env with your actual values');
  console.error('3. Generate a secure SESSION_SECRET (32+ characters)');
  console.error('4. Use strong passwords for ADMIN_PASSWORD');
  console.error('');
  console.error('See env.example for all required variables.');
  process.exit(1);
}

app.use(session({
  secret: SESSION_SECRET,
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

// Point-in-polygon detection using ray casting algorithm
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Check if a point is inside TMNP (considering holes)
function pointInTMNP(lat, lon, tmnpPolygons) {
  if (!tmnpPolygons || tmnpPolygons.length === 0) return false;
  
  for (const polygon of tmnpPolygons) {
    // Check if point is in outer boundary
    const inOuter = pointInPolygon([lon, lat], polygon.outer);
    
    if (inOuter) {
      // Check if point is in any holes (inner boundaries)
      let inHole = false;
      for (const hole of polygon.inner) {
        if (pointInPolygon([lon, lat], hole)) {
          inHole = true;
          break;
        }
      }
      
      // If in outer boundary but not in any hole, it's inside TMNP
      if (!inHole) {
        return true;
      }
    }
  }
  
  return false;
}

// Load TMNP coordinates from KML file
function loadTMNPCoordinates() {
  try {
    const kmlPath = path.join(__dirname, '..', 'public', 'tmnp.kml');
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    const polygons = [];
    
    function processPolygon(polygonObj) {
      if (!polygonObj || !polygonObj.outerBoundaryIs) return;
      
      const outer = [];
      const inner = [];
      
      // Extract outer boundary
      const outerCoords = polygonObj.outerBoundaryIs.LinearRing.coordinates;
      if (outerCoords) {
        const coordStr = typeof outerCoords === 'string' ? outerCoords : outerCoords.toString();
        const coordLines = coordStr.trim().split(/\s+/);
        
        for (const line of coordLines) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              outer.push([lon, lat]);
            }
          }
        }
      }
      
      // Extract inner boundaries (holes)
      if (polygonObj.innerBoundaryIs) {
        const innerBoundaries = Array.isArray(polygonObj.innerBoundaryIs) ? 
          polygonObj.innerBoundaryIs : [polygonObj.innerBoundaryIs];
        
        for (const innerBoundary of innerBoundaries) {
          if (innerBoundary.LinearRing && innerBoundary.LinearRing.coordinates) {
            const innerCoords = innerBoundary.LinearRing.coordinates;
            const coordStr = typeof innerCoords === 'string' ? innerCoords : innerCoords.toString();
            const coordLines = coordStr.trim().split(/\s+/);
            
            const hole = [];
            for (const line of coordLines) {
              const parts = line.split(',');
              if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (!isNaN(lat) && !isNaN(lon)) {
                  hole.push([lon, lat]);
                }
              }
            }
            
            if (hole.length > 0) {
              inner.push(hole);
            }
          }
        }
      }
      
      if (outer.length > 0) {
        polygons.push({ outer, inner });
      }
    }
    
    // Find and process all Polygon elements
    function findPolygons(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      if (obj.Polygon) {
        const polygonElements = Array.isArray(obj.Polygon) ? obj.Polygon : [obj.Polygon];
        for (const polygon of polygonElements) {
          processPolygon(polygon);
        }
      }
      
      // Recursively search
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          findPolygons(obj[key]);
        }
      }
    }
    
    findPolygons(xml);
    return polygons;
    
  } catch (error) {
    console.error('❌ Error loading TMNP coordinates:', error.message);
    return [];
  }
}

// Check if KML file contains violations (enters TMNP airspace)
async function checkForViolations(filePath) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    // Extract coordinates from KML
    const coordinates = [];
    
    function extractCoords(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      // Check for gx:Track coordinates (ADS-B Exchange format)
      if (obj['gx:Track'] && obj['gx:Track'].coord) {
        const coordElements = Array.isArray(obj['gx:Track'].coord) ? obj['gx:Track'].coord : [obj['gx:Track'].coord];
        for (const coord of coordElements) {
          const parts = coord.split(' ');
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              coordinates.push({ lat, lon });
            }
          }
        }
      }
      
      // Check for LineString coordinates (FlightRadar24 format)
      if (obj.LineString && obj.LineString.coordinates) {
        const coordStr = obj.LineString.coordinates;
        const coordLines = coordStr.trim().split(/\s+/);
        for (const line of coordLines) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              coordinates.push({ lat, lon });
            }
          }
        }
      }
      
      // Recursively search other objects
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          extractCoords(obj[key]);
        }
      }
    }
    
    extractCoords(xml);
    
    if (coordinates.length === 0) {
      console.log('⚠️ No coordinates found in KML file');
      return false;
    }
    
    console.log(`📍 Found ${coordinates.length} coordinate points`);
    
    // Load TMNP boundary and check for violations
    const tmnpPolygons = loadTMNPCoordinates();
    if (tmnpPolygons.length === 0) {
      console.log('⚠️ TMNP boundary not found or invalid');
      return false;
    }
    
    console.log(`🗺️ Loaded ${tmnpPolygons.length} TMNP polygon(s)`);
    
    // Check each coordinate point for TMNP violations
    let hasViolations = false;
    let violationCount = 0;
    
    for (const coord of coordinates) {
      if (pointInTMNP(coord.lat, coord.lon, tmnpPolygons)) {
        hasViolations = true;
        violationCount++;
      }
    }
    
    if (hasViolations) {
      console.log(`🚁 Flight enters TMNP airspace: ${violationCount} violation point(s) out of ${coordinates.length} total`);
    } else {
      console.log(`✅ Flight does not enter TMNP airspace (0/${coordinates.length} points)`);
    }
    
    return hasViolations;
    
  } catch (error) {
    console.error('❌ Error checking violations:', error.message);
    return false;
  }
}

// 🚀 OPTIMIZED: Pre-load existing file hashes for fast duplicate detection
let existingFileHashes = null;
let existingFileHashesLoaded = false;

function loadExistingFileHashes() {
  if (existingFileHashesLoaded) return existingFileHashes;
  
  console.log('⚡ Pre-loading existing file hashes for fast duplicate detection...');
  existingFileHashes = new Map();
  
  try {
    for (const flight of kmlMetadata) {
      const existingFilePath = path.join(uploadsDir, flight.filename);
      if (fs.existsSync(existingFilePath)) {
        const existingContent = fs.readFileSync(existingFilePath);
        const existingHash = require('crypto').createHash('md5').update(existingContent).digest('hex');
        existingFileHashes.set(existingHash, flight.filename);
      }
    }
    existingFileHashesLoaded = true;
    console.log(`✅ Pre-loaded ${existingFileHashes.size} file hashes for fast duplicate detection`);
  } catch (error) {
    console.log(`⚠️ Error pre-loading file hashes: ${error.message}`);
    existingFileHashes = new Map();
  }
  
  return existingFileHashes;
}

// Check if a flight already exists (OPTIMIZED for speed)
function isDuplicateFlight(kmlInfo, filePath) {
  try {
    // Check 1: Flight signature (registration + date + time) - FAST
    const flightSignature = `${kmlInfo.registration}-${kmlInfo.date}-${kmlInfo.time}`;
    
    // Check if we already have a flight with this signature
    const existingFlight = kmlMetadata.find(flight => 
      flight.registration === kmlInfo.registration &&
      flight.date === kmlInfo.date &&
      flight.time === kmlInfo.time
    );
    
    if (existingFlight) {
      console.log(`🔄 Duplicate flight detected: ${flightSignature} (already exists as ${existingFlight.filename})`);
      return {
        isDuplicate: true,
        reason: 'FLIGHT_SIGNATURE_MATCH',
        existingFile: existingFlight.filename,
        details: `Flight ${kmlInfo.registration} on ${kmlInfo.date} at ${kmlInfo.time} already exists`
      };
    }
    
    // Check 2: Content hash (OPTIMIZED - uses pre-loaded hashes)
    try {
      const fileContent = fs.readFileSync(filePath);
      const contentHash = require('crypto').createHash('md5').update(fileContent).digest('hex');
      
      // Use pre-loaded hashes instead of reading all files again
      const existingFileHashes = loadExistingFileHashes();
      const existingFile = existingFileHashes.get(contentHash);
      
      if (existingFile) {
        console.log(`🔄 Exact file duplicate detected: same content as ${existingFile}`);
        return {
          isDuplicate: true,
          reason: 'CONTENT_HASH_MATCH',
          existingFile: existingFile,
          details: `File content is identical to existing file ${existingFile}`
        };
      }
    } catch (hashError) {
      console.log(`⚠️ Could not check content hash: ${hashError.message}`);
    }
    
    return { isDuplicate: false };
    
  } catch (error) {
    console.log(`⚠️ Error checking for duplicates: ${error.message}`);
    return { isDuplicate: false };
  }
}

// Generate PNG flight map for a KML file
async function generateFlightMap(filename) {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    // Use the existing flight image generator
    const generatorPath = path.join(__dirname, 'generate-flight-image.cjs');
    if (!fs.existsSync(generatorPath)) {
      console.log('⚠️ Flight image generator not found, skipping PNG generation');
      return false;
    }
    
    // Create a temporary script for this specific file
    const originalScript = fs.readFileSync(generatorPath, 'utf8');
    const modifiedScript = originalScript.replace(
      'const kmlFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith(\'.kml\'));',
      `const kmlFiles = ['${filename}'];`
    ).replace(
      'processAllFiles().catch(console.error);',
      `
async function processSpecificFile() {
  console.log('Generating PNG for: ${filename}');
  try {
    await generateFlightImage('${filename}');
    console.log('✅ PNG generated successfully');
  } catch (error) {
    console.error('❌ Error generating PNG:', error.message);
    throw error;
  }
}

processSpecificFile().catch(console.error);
      `
    );
    
    // Write and execute the temporary script
    const tempScript = path.join(__dirname, 'temp-flight-map.cjs');
    fs.writeFileSync(tempScript, modifiedScript);
    
    try {
      const { stdout, stderr } = await execAsync(`node temp-flight-map.cjs`, { cwd: __dirname });
      if (stderr) console.error('PNG generation stderr:', stderr);
      return true;
    } finally {
      // Clean up
      if (fs.existsSync(tempScript)) {
        fs.unlinkSync(tempScript);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error generating flight map for ${filename}:`, error.message);
    return false;
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

// Fast metadata loading from pre-generated file
async function loadMetadataFromMasterFile() {
  const masterFile = path.join(__dirname, 'master-metadata.json');
  
  if (fs.existsSync(masterFile)) {
    try {
      const masterData = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
      kmlMetadata = masterData.flights;
      console.log(`🚀 Loaded ${kmlMetadata.length} flights from master metadata (generated: ${masterData.generated})`);
      console.log(`📊 Total files: ${masterData.totalFiles}, Valid flights: ${masterData.validFlights}`);
      return true;
    } catch (error) {
      console.log(`❌ Error reading master metadata: ${error.message}`);
      return false;
    }
  }
  
  console.log(`⚠️ Master metadata file not found. Run 'node generate-master-metadata.cjs' to generate it.`);
  return false;
}

async function scanKmlMetadata() {
  // Try to load from master file first (FAST!)
  const masterLoaded = await loadMetadataFromMasterFile();
  if (masterLoaded) {
    return; // We're done! Super fast startup 🚀
  }
  
  // Fallback to legacy scanning (SLOW - only if master file missing)
  console.log('⚠️ Falling back to legacy KML scanning (this is slow)...');
  console.log('💡 Generate master metadata with: node generate-master-metadata.cjs');
  
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
  // Check if data is already enriched (from master file)
  const firstFlight = kmlMetadata[0];
  const isEnriched = firstFlight && (firstFlight.hasOwnProperty('owner') || firstFlight.hasOwnProperty('imageUrl'));
  
  if (isEnriched) {
    // Data is already enriched from master file - serve as-is
    res.json(kmlMetadata);
  } else {
    // Legacy format - need to merge with helicopter metadata
    const enrichedMetadata = kmlMetadata.map(flight => {
      const heliData = helicopterMetadata[flight.registration] || {};
      return {
        ...flight,
        owner: heliData.owner || '',
        contact: heliData.contact || '',
        imageUrl: heliData.imageUrl || ''
      };
    });
    res.json(enrichedMetadata);
  }
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

// Health check endpoint for production monitoring
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

// Add specific route for KML files to redirect to GitHub LFS
app.get('/kml/:filename', (req, res) => {
  const filename = req.params.filename;
  const githubUrl = `https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/${filename}`;
  
  res.redirect(301, githubUrl);
});

// KML Validation Portal endpoint
app.post('/api/validate-kml', 
  // Security middleware
  (req, res, next) => {
    // Only allow local connections for security
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const isLocal = clientIP.includes('127.0.0.1') || 
                     clientIP.includes('::1') || 
                     clientIP.includes('localhost') ||
                     clientIP.includes('192.168.') ||
                     clientIP.includes('10.') ||
                     clientIP.includes('172.');
    
    if (!isLocal) {
      console.log(`🚫 Access denied to validation endpoint from IP: ${clientIP}`);
      return res.status(403).json({ 
        error: 'Access denied - validation endpoint is local-only for security',
        clientIP: clientIP
      });
    }
    next();
  },
  // File upload middleware
  upload.array('kml', 20),
  // Main handler
  async (req, res) => {
  try {
    console.log(`🚁 Processing ${req.files.length} KML files for validation...`);
    const results = [];
    
    // 🚀 OPTIMIZATION: Process all files in parallel instead of sequentially
    // This makes the validation portal as fast as the fast method!
    // All files are processed simultaneously, including PNG generation
    console.log(`⚡ Processing ${req.files.length} files in parallel for maximum speed...`);
    
    // Pre-load existing file hashes once for fast duplicate detection
    loadExistingFileHashes();
    
    const processPromises = req.files.map(async (file) => {
      console.log(`📁 Validating: ${file.originalname}`);
      
      try {
        // Extract metadata first (fast)
        const kmlInfo = extractKmlInfoFromFile(file.path, file.originalname);
        
        if (!kmlInfo.registration) {
          return {
            filename: file.originalname,
            status: 'INVALID',
            error: 'No registration found in KML file',
            saved: false
          };
        }
        
        // 🚀 OPTIMIZATION: Check for duplicates FIRST (fast) before expensive violation detection
        const duplicateCheck = isDuplicateFlight(kmlInfo, file.path);
        
        if (duplicateCheck.isDuplicate) {
          console.log(`⏭️ Skipping duplicate: ${duplicateCheck.details}`);
          
          // Clean up temp file for duplicate
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
              console.log(`🗑️ Cleaned up temp file for duplicate: ${file.path}`);
            }
          } catch (cleanupError) {
            console.log(`⚠️ Could not clean up temp file for duplicate: ${cleanupError.message}`);
          }
          
          return {
            filename: file.originalname,
            status: 'DUPLICATE_SKIPPED',
            registration: kmlInfo.registration,
            date: kmlInfo.date,
            time: kmlInfo.time,
            reason: duplicateCheck.reason,
            existingFile: duplicateCheck.existingFile,
            details: duplicateCheck.details,
            saved: false
          };
        }
        
        // Only check for violations if it's NOT a duplicate (expensive operation)
        console.log(`🚁 Checking violations for non-duplicate flight: ${file.originalname}`);
        const hasViolations = await checkForViolations(file.path);
        
        if (hasViolations) {
          console.log(`🚁 Processing violating flight: ${file.originalname}`);
          
          // Generate proper filename (YYYY-MM-DD-REGISTRATION-HASH.kml) FIRST
          const hash = require('crypto').createHash('md5').update(file.originalname).digest('hex').slice(0, 8);
          const newFilename = `${kmlInfo.date}-${kmlInfo.registration}-${hash}.kml`;
          const newFilePath = path.join(uploadsDir, newFilename);
          
          console.log(`🔄 Will save directly as: ${newFilename}`);
          
          try {
            // Save directly with proper filename (atomic operation)
            fs.copyFileSync(file.path, newFilePath);
            console.log(`✅ File saved directly with proper name: ${newFilename}`);
            
            // Verify file exists
            if (fs.existsSync(newFilePath)) {
              console.log(`✅ File exists: ${newFilePath}`);
              const stats = fs.statSync(newFilePath);
              console.log(`📊 File size: ${stats.size} bytes`);
            } else {
              console.log(`❌ File does not exist after save: ${newFilePath}`);
            }
              
            // Generate PNG flight map (this will run in parallel with other files)
            console.log(`🖼️ Starting PNG generation for: ${newFilename}`);
            const pngResult = await generateFlightMap(newFilename);
            console.log(`🖼️ PNG generation result: ${pngResult ? 'SUCCESS' : 'FAILED'}`);
            
            // Add to metadata with new filename
            const flightData = {
              filename: newFilename,
              registration: kmlInfo.registration,
              date: kmlInfo.date,
              time: kmlInfo.time,
              owner: kmlInfo.owner || 'Unknown',
              fileSizeMB: (file.size / (1024 * 1024)).toFixed(2)
            };
            
            kmlMetadata.push(flightData);
            console.log(`📝 Added to metadata: ${JSON.stringify(flightData)}`);
            
            // Clean up temporary file NOW (after we're done with it)
            try {
              if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
                console.log(`🗑️ Cleaned up temp file: ${file.path}`);
              }
            } catch (cleanupError) {
              console.log(`⚠️ Could not clean up temp file: ${cleanupError.message}`);
            }
            
            return {
              filename: file.originalname,
              newFilename: newFilename,
              status: 'VIOLATION_DETECTED',
              registration: kmlInfo.registration,
              date: kmlInfo.date,
              time: kmlInfo.time,
              violations: hasViolations,
              saved: true,
              pngGenerated: pngResult
            };
            
          } catch (saveError) {
            console.error(`❌ Error saving violating flight:`, saveError.message);
            throw saveError;
          }
          
        } else {
          // Don't save non-violating flights
          console.log(`❌ Rejected non-violating flight: ${file.originalname}`);
          
          // Clean up temp file for non-violating flights
          try {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          } catch (cleanupError) {
            console.log(`⚠️ Could not clean up temp file for non-violating flight: ${cleanupError.message}`);
          }
          
          return {
            filename: file.originalname,
            status: 'NO_VIOLATIONS',
            registration: kmlInfo.registration,
            date: kmlInfo.date,
            time: kmlInfo.time,
            violations: [],
            saved: false
          };
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${file.originalname}:`, error.message);
        
        // Clean up temp file on error
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.log(`⚠️ Could not clean up temp file on error: ${cleanupError.message}`);
        }
        
        return {
          filename: file.originalname,
          status: 'ERROR',
          error: error.message,
          saved: false
        };
      }
    });
    
    // Wait for all files to be processed in parallel
    const fileResults = await Promise.all(processPromises);
    results.push(...fileResults);
    
    // Generate summary
    const savedCount = results.filter(r => r.saved).length;
    const rejectedCount = results.filter(r => !r.saved && r.status !== 'ERROR').length;
    const errorCount = results.filter(r => r.status === 'ERROR').length;
    
    console.log(`📊 Validation complete: ${savedCount} saved, ${rejectedCount} rejected, ${errorCount} errors`);
    
    // Clear cache and refresh metadata if we saved any files
    if (savedCount > 0) {
      try {
        // Clear metadata cache
        const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
        if (fs.existsSync(cacheFile)) {
          fs.unlinkSync(cacheFile);
          console.log('🗑️ Cleared metadata cache');
        }
        
        // Clear master metadata cache to force refresh
        const masterCacheFile = path.join(__dirname, 'master-metadata.json');
        if (fs.existsSync(masterCacheFile)) {
          fs.unlinkSync(masterCacheFile);
          console.log('🗑️ Cleared master metadata cache');
        }
        
        console.log('🔄 Metadata caches cleared - system will refresh on next request');
      } catch (error) {
        console.error('⚠️ Warning: Could not clear cache:', error.message);
      }
    }
    
    res.json({
      success: true,
      results: results,
      summary: {
        total: req.files.length,
        saved: savedCount,
        rejected: rejectedCount,
        errors: errorCount
      },
      cacheCleared: savedCount > 0
    });
    
  } catch (error) {
    console.error('❌ Validation endpoint error:', error);
    res.status(500).json({ 
      error: 'Validation failed', 
      details: error.message 
    });
  }
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