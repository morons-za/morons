require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');
const axios = require('axios'); // For downloading images
const SmartKMLManager = require('./smart-kml-manager.cjs');
const { spawn } = require('child_process');
const GitDeployer = require('./deploy-to-github.cjs');
const FrontendParser = require('./frontend-parser.cjs');

const app = express();
const PORT = process.env.PORT || 4000;

console.log('🔓 Running in NO-AUTH mode - suitable for local development only!');

// Development mode flag - skip heavy scanning for faster startup
const DEV_MODE = process.env.DEV_MODE === 'true' || process.argv.includes('--dev');
if (DEV_MODE) {
  console.log('🚀 Development mode enabled - skipping KML scanning for faster startup');
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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
    // Don't reject files at Multer level - handle duplicates in the upload endpoint
    // This prevents the entire request from failing
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
  const githubUrl = `https://media.githubusercontent.com/media/morons-za/morons/main/server/uploads/${filename}`;
  
  res.redirect(301, githubUrl);
});

// Redirect flight-maps to GitHub LFS
app.get('/flight-maps/:filename', (req, res) => {
  const filename = req.params.filename;
  const githubUrl = `https://media.githubusercontent.com/media/morons-za/morons/main/server/flight-maps/${filename}`;
  
  res.redirect(301, githubUrl);
});

app.use('/images', express.static(imagesDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Server status endpoint for the HTML interface
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    flights: kmlMetadata.length,
    helicopters: Object.keys(helicopterMetadata).length,
    timestamp: new Date().toISOString()
  });
});

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
        
        // Extract image URL (photo)
        const imageMatch = desc.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
        if (imageMatch) {
          imageUrl = imageMatch[1];
          console.log(`[KML REGEX] Found image URL: ${imageUrl}`);
        }
        
        // Extract owner info
        const ownerMatch = desc.match(/Owner<[^>]*>.*?<td[^>]*>([^<]+)</i);
        if (ownerMatch) {
          owner = ownerMatch[1].trim();
          console.log(`[KML REGEX] Found owner: ${owner}`);
        }
      }
      
      // Extract date/time from first placemark
      const firstPlacemark = findFirstPlacemark(kmlRoot);
      if (firstPlacemark && firstPlacemark.TimeStamp && firstPlacemark.TimeStamp.when) {
        const timestamp = firstPlacemark.TimeStamp.when;
        const dateMatch = timestamp.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = timestamp.match(/T(\d{2}:\d{2})/);
        if (dateMatch) date = dateMatch[1];
        if (timeMatch) time = timeMatch[1];
        console.log(`[KML TIME] Extracted from TimeStamp: ${date} ${time}`);
      }
    } else {
      // ADS-B Exchange or other formats
      // Try filename parsing first: "2025-02-13_ZS-HMB_09-18-UTC.kml"
      const fileMatch = filename.match(/(\d{4}-\d{2}-\d{2}).*?([A-Z]{2}-[A-Z0-9]{3}).*?(\d{2}-\d{2})/);
      if (fileMatch) {
        date = fileMatch[1];
        registration = fileMatch[2];
        time = fileMatch[3].replace('-', ':');
        console.log(`[FILENAME] Parsed from filename: ${registration} on ${date} at ${time}`);
      }
      
      // Fallback: try to extract from KML content
      if (!registration || !date || !time) {
        const firstPlacemark = findFirstPlacemark(kmlRoot);
        if (firstPlacemark) {
          // Try name field for registration
          if (!registration && firstPlacemark.name) {
            const regMatch = firstPlacemark.name.match(/([A-Z]{2}-[A-Z0-9]{3})/);
            if (regMatch) {
              registration = regMatch[1];
              console.log(`[KML NAME] Found registration in placemark name: ${registration}`);
            }
          }
          
          // Try description field for registration
          if (!registration && firstPlacemark.description) {
            const regMatch = firstPlacemark.description.match(/([A-Z]{2}-[A-Z0-9]{3})/);
            if (regMatch) {
              registration = regMatch[1];
              console.log(`[KML DESC] Found registration in placemark description: ${registration}`);
            }
          }
          
          // Extract date/time from gx:Track when elements (ADS-B Exchange)
          if ((!date || !time) && firstPlacemark['gx:Track'] && firstPlacemark['gx:Track'].when) {
            const whenElements = Array.isArray(firstPlacemark['gx:Track'].when) ? 
              firstPlacemark['gx:Track'].when : [firstPlacemark['gx:Track'].when];
            if (whenElements.length > 0) {
              const firstWhen = whenElements[0];
              const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
              if (whenMatch) {
                date = whenMatch[1];
                time = whenMatch[2];
                console.log(`[GX:TRACK] Extracted from when element: ${date} ${time}`);
              }
            }
          }
        }
      }
    }
    
    // Fallback: extract from filename if still missing
    if (!registration) {
      const fileRegMatch = filename.match(/([A-Z]{2}-[A-Z0-9]{3})/);
      if (fileRegMatch) {
        registration = fileRegMatch[1];
        console.log(`[FALLBACK] Extracted registration from filename: ${registration}`);
      }
    }
    
    if (!date) {
      const fileDateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      if (fileDateMatch) {
        date = fileDateMatch[1];
        console.log(`[FALLBACK] Extracted date from filename: ${date}`);
      }
    }
    
    return {
      filename,
      registration: registration || 'UNKNOWN',
      date: date || 'UNKNOWN',
      time: time || 'UNKNOWN',
      imageUrl: imageUrl || '',
      owner: owner || ''
    };
  } catch (error) {
    console.error(`❌ Error parsing ${filename}:`, error.message);
    return {
      filename,
      registration: 'ERROR',
      date: 'ERROR',
      time: 'ERROR',
      imageUrl: '',
      owner: ''
    };
  }
}

// Cache image function
async function cacheImage(imageUrl, registration) {
  try {
    if (!imageUrl) return '';
    
    // Skip if already cached
    const filename = `${registration}.jpg`;
    const localPath = path.join(imagesDir, filename);
    if (fs.existsSync(localPath)) {
      console.log(`🖼️ Image already cached: ${filename}`);
      return `/images/${filename}`;
    }
    
    console.log(`📥 Downloading image for ${registration}...`);
    const response = await axios.get(imageUrl, { responseType: 'stream' });
    const writer = fs.createWriteStream(localPath);
    
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    console.log(`✅ Cached image: ${filename}`);
    return `/images/${filename}`;
  } catch (error) {
    console.log(`❌ Error caching image for ${registration}: ${error.message}`);
    return imageUrl; // Return original URL if caching fails
  }
}

// Load TMNP boundary coordinates from KML file
function loadTMNPCoordinates() {
  try {
    const kmlPath = path.join(__dirname, '..', '..', 'static-site', 'tmnp.kml');
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
            // Fix: KML coordinates are in lon,lat format (not lat,lon)
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              outer.push([lon, lat]); // Store as lon,lat for pointInPolygon function
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
                // Fix: KML coordinates are in lon,lat format (not lat,lon)
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (!isNaN(lat) && !isNaN(lon)) {
                  hole.push([lon, lat]); // Store as lon,lat for pointInPolygon function
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
      
      // Handle direct Polygon elements
      if (obj.Polygon) {
        const polygonElements = Array.isArray(obj.Polygon) ? obj.Polygon : [obj.Polygon];
        for (const polygon of polygonElements) {
          processPolygon(polygon);
        }
      }
      
      // Handle MultiGeometry containing polygons
      if (obj.MultiGeometry && obj.MultiGeometry.Polygon) {
        const polygonElements = Array.isArray(obj.MultiGeometry.Polygon) ? obj.MultiGeometry.Polygon : [obj.MultiGeometry.Polygon];
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
    // Polygon is stored as [lat, lon], but pointInPolygon expects [lon, lat] for ray-casting
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
      
      // Check for gx:coord elements (ADS-B Exchange format)
      if (obj['gx:coord']) {
        const coordElements = Array.isArray(obj['gx:coord']) ? obj['gx:coord'] : [obj['gx:coord']];
        for (const coord of coordElements) {
          if (typeof coord === 'string') {
            const parts = coord.trim().split(/\s+/);
            if (parts.length >= 2) {
              const lon = parseFloat(parts[0]);
              const lat = parseFloat(parts[1]);
              if (!isNaN(lat) && !isNaN(lon)) {
                coordinates.push({ lat, lon });
              }
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
      
      // Check for Point coordinates (individual point format)
      if (obj.Point && obj.Point.coordinates) {
        const coordStr = obj.Point.coordinates;
        const parts = coordStr.split(',');
        if (parts.length >= 2) {
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            coordinates.push({ lat, lon });
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
        const existingContent = fs.readFileSync(existingFilePath, 'utf8');
        // Use raw content hash - timestamps are important for distinguishing different flights
        const existingHash = require('crypto').createHash('md5').update(existingContent).digest('hex');
        existingFileHashes.set(existingHash, flight.filename);
      }
    }
    existingFileHashesLoaded = true;
    console.log(`✅ Pre-loaded ${existingFileHashes.size} file hashes for fast duplicate detection`);
  } catch (error) {
    console.log(`⚠️ Error pre-loading file hashes: ${error.message}`);
    existingFileHashes = new Map();
    existingFileHashesLoaded = true;
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
      const fileContent = fs.readFileSync(filePath, 'utf8');
      // Use raw content hash - timestamps are important for distinguishing different flights
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

// Load metadata from master file (FAST startup)
async function loadMetadataFromMasterFile() {
  try {
    const masterFile = path.join(__dirname, '..', 'server', 'master-metadata.json');
    if (!fs.existsSync(masterFile)) {
      console.log('🔍 Master metadata file not found, falling back to legacy scanning...');
      return false;
    }

    console.log('⚡ Loading metadata from master file (super fast!)...');
    const masterData = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
    
    if (masterData && masterData.flights && masterData.flights.length > 0) {
      kmlMetadata = masterData.flights;
      console.log(`🚀 Loaded ${kmlMetadata.length} flights from master metadata file!`);
      return true;
    }
  } catch (error) {
    console.log(`❌ Error loading master metadata: ${error.message}`);
  }
  return false;
}

async function scanKmlMetadata() {
  // Try to load from master file first (FAST!)
  const masterLoaded = await loadMetadataFromMasterFile();
  if (masterLoaded) {
    return; // We're done! Super fast startup 🚀
  }
  
  // Try to load from cache file
  const cacheFile = path.join(__dirname, '..', 'server', 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      kmlMetadata = cached.map(flight => ({
        filename: flight.filename,
        registration: flight.registration,
        date: flight.date,
        time: flight.time
      }));
      console.log(`📋 Loaded ${cached.length} flights from cache`);
      return;
    } catch (e) {
      console.log(`❌ Error reading cache: ${e.message}`);
    }
  }
  
  // No metadata files found - server will start with empty data
  console.log('⚠️ No metadata files found (master-metadata.json or kml-metadata-cache.json)');
  console.log('💡 Server starting with empty flight data - use backend interface to generate metadata');
  console.log('🔧 Available actions:');
  console.log('   • Process KMLs - runs Smart KML Manager to organize files');
  console.log('   • Refresh Metadata - generates fresh metadata from all KML files');
  console.log('   • Validate Files - checks status of KML files and generated assets');
  kmlMetadata = [];
}

// Initial scan on startup (make it async)
(async () => {
  await scanKmlMetadata();
  loadHelicopterMetadata();
})();

// Generate PNG flight map for a KML file
async function generateFlightMap(filename) {
  try {
    console.log(`🖼️ Starting PNG generation for: ${filename}`);
    
    // Execute the PNG generator as a child process
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['generate-flight-image.cjs', filename], {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe']
      });
      
      child.stdout.on('data', (data) => {
        console.log(`[PNG] ${data.toString().trim()}`);
      });
      
      child.stderr.on('data', (data) => {
        console.error(`[PNG ERROR] ${data.toString().trim()}`);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ PNG generated successfully for ${filename}`);
          resolve(true);
        } else {
          console.log(`❌ PNG generation failed for ${filename} (exit code: ${code})`);
          resolve(false);
        }
      });
      
      child.on('error', (error) => {
        console.error(`❌ PNG generation error for ${filename}:`, error.message);
        resolve(false);
      });
    });
    
  } catch (error) {
    console.error(`❌ PNG generation error for ${filename}:`, error.message);
    return false;
  }
}

// Upload endpoint (NO AUTH required) - supports multiple files
app.post('/upload', upload.array('kml', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  
  console.log(`📁 Processing ${req.files.length} uploaded files...`);
  const results = [];
  const errors = [];
  
  // Pre-load existing file hashes once for fast duplicate detection
  loadExistingFileHashes();
  
  // Process each uploaded file with validation
  for (const file of req.files) {
    try {
      console.log(`📄 Processing: ${file.originalname}`);
      
      // Extract metadata first (fast)
      const meta = extractKmlInfoFromFile(file.path, file.originalname);
      
      if (!meta.registration) {
        console.log(`❌ Invalid KML: No registration found in ${file.originalname}`);
        errors.push({
          filename: file.originalname,
          error: 'No registration found in KML file',
          status: 'INVALID'
        });
        continue;
      }
      
      // Check for duplicates FIRST (fast) before expensive violation detection
      const duplicateCheck = isDuplicateFlight(meta, file.path);
      
      if (duplicateCheck.isDuplicate) {
        console.log(`⏭️ Skipping duplicate: ${duplicateCheck.details}`);
        
        results.push({
          filename: file.originalname,
          originalname: file.originalname,
          registration: meta.registration,
          date: meta.date,
          time: meta.time,
          status: 'DUPLICATE_SKIPPED',
          reason: duplicateCheck.reason,
          existingFile: duplicateCheck.existingFile,
          details: duplicateCheck.details
        });
        continue;
      }
      
      // Only check for violations if it's NOT a duplicate (expensive operation)
      console.log(`🚁 Checking violations for non-duplicate flight: ${file.originalname}`);
      const hasViolations = await checkForViolations(file.path);
      
      if (!hasViolations) {
        console.log(`❌ NO VIOLATIONS: ${file.originalname} does not enter TMNP airspace - REJECTED`);
        
        // Clean up non-violating file
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
            console.log(`🗑️ Cleaned up non-violating file: ${file.path}`);
          }
        } catch (cleanupError) {
          console.log(`⚠️ Could not clean up non-violating file: ${cleanupError.message}`);
        }
        
        results.push({
          filename: file.originalname,
          originalname: file.originalname,
          registration: meta.registration,
          date: meta.date,
          time: meta.time,
          status: 'NO_VIOLATION_REJECTED',
          error: 'Flight does not enter TMNP restricted airspace',
          details: 'Only flights that violate TMNP airspace are accepted by this system'
        });
        continue;
      }
      
      // File has violations - process normally (this is what we want)
      console.log(`✅ VIOLATION CONFIRMED: ${file.originalname} enters TMNP airspace - ACCEPTED`);
      
      // Cache image if available
      if (meta.imageUrl && meta.registration) {
        meta.imageUrl = await cacheImage(meta.imageUrl, meta.registration);
      }
      
      // Add to current metadata immediately if valid
      if (meta.registration) {
        kmlMetadata.push({
          filename: meta.filename,
          registration: meta.registration,
          date: meta.date,
          time: meta.time
        });
        console.log(`✅ Added ${meta.registration} to metadata`);
      }
      
      // Add to results
      results.push({
        filename: file.originalname,
        originalname: file.originalname,
        url: `/uploads/${file.originalname}`,
        imageUrl: meta.imageUrl || '',
        owner: meta.owner || '',
        registration: meta.registration || '',
        date: meta.date || '',
        time: meta.time || '',
        status: 'success'
      });
      
    } catch (error) {
      console.log(`❌ Error processing ${file.originalname}: ${error.message}`);
      errors.push({
        filename: file.originalname,
        error: error.message,
        status: 'error'
      });
    }
  }
  
  // Invalidate cache after all files processed
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
      console.log(`🗑️ Invalidated cache after ${req.files.length} uploads`);
    } catch (e) {
      console.log(`❌ Error deleting cache: ${e.message}`);
    }
  }
  
  // Auto-trigger Smart KML Manager for new uploads (with delay to avoid race conditions)
  let smartManagerResults = null;
  try {
    console.log('🧠 Auto-processing uploads with Smart KML Manager...');
    // Add small delay to ensure all files are fully written before processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    const manager = new SmartKMLManager();
    smartManagerResults = await manager.processNewFiles();
    if (smartManagerResults.processed > 0) {
      console.log(`✨ Smart Manager processed ${smartManagerResults.processed} new files, renamed ${smartManagerResults.renamed}`);
    }
  } catch (error) {
    console.log(`⚠️ Smart Manager auto-processing error: ${error.message}`);
    smartManagerResults = { processed: 0, renamed: 0, duplicates: 0, error: error.message };
  }
  
  // Generate PNG flight maps for all uploaded files
  console.log('🖼️ Starting PNG generation for uploaded files...');
  const pngPromises = results.map(async (result) => {
    if (result.status === 'success' && result.filename) {
      try {
        // SmartKMLManager renamed files after they were saved, so we need to use the renamed filename
        // The renamed filename follows the pattern: YYYY-MM-DD-REG-HASH.kml
        // We need to find it in the uploads directory or construct it from metadata
        
        let filenameToUse = result.filename;
        
        // Check if file exists with this name
        const filePath = path.join(__dirname, '..', 'uploads', filenameToUse);
        if (!fs.existsSync(filePath)) {
          // File was renamed, try to find it by checking uploads directory
          // Look for files matching the pattern with the hash
          try {
            const files = fs.readdirSync(path.join(__dirname, '..', 'uploads'));
            // Result filename might be just the hash (e.g., "3ce6b9a6.kml")
            const hashMatch = result.filename.match(/^([a-f0-9]{8})\.kml$/);
            if (hashMatch) {
              const hash = hashMatch[1];
              // Find the file with this hash in the uploads directory
              const matchingFile = files.find(f => f.includes(hash) && f.endsWith('.kml'));
              if (matchingFile) {
                filenameToUse = matchingFile;
                console.log(`📝 Found renamed file: ${result.filename} → ${filenameToUse}`);
              }
            }
          } catch (searchError) {
            console.log(`⚠️ Could not search for renamed file: ${searchError.message}`);
          }
        }
        
        const pngSuccess = await generateFlightMap(filenameToUse);
        result.pngGenerated = pngSuccess;
        if (pngSuccess) {
          console.log(`✅ PNG generated for: ${filenameToUse}`);
        } else {
          console.log(`⚠️ PNG generation failed for: ${filenameToUse}`);
        }
      } catch (error) {
        console.log(`❌ PNG generation error for ${result.filename}: ${error.message}`);
        result.pngGenerated = false;
      }
    }
    return result;
  });
  
  // Wait for all PNG generation to complete
  try {
    await Promise.all(pngPromises);
    console.log('✅ PNG generation completed for all files');
  } catch (error) {
    console.log(`⚠️ Some PNG generations may have failed: ${error.message}`);
  }
  
  // Count only successfully processed files (not duplicates or rejections)
  const successfullyProcessed = results.filter(r => r.status === 'success').length;
  const duplicates = results.filter(r => r.status === 'DUPLICATE_SKIPPED').length;
  const rejections = results.filter(r => r.status === 'NO_VIOLATION_REJECTED').length;
  
  // Automatically optimize KML files for successfully processed files
  let optimizationResult = null;
  if (successfullyProcessed > 0) {
    try {
      console.log(`🔧 Automatically optimizing KML files for ${successfullyProcessed} processed file(s)...`);
      const optResult = await optimizeKMLFiles();
      
      // Parse stdout to extract processed count
      const processedMatch = optResult.stdout ? optResult.stdout.match(/Successfully processed:\s*(\d+)/) : null;
      const processed = processedMatch ? parseInt(processedMatch[1]) : 0;
      
      optimizationResult = {
        success: true,
        processed: processed,
        message: `KML optimization completed: ${processed} files optimized`
      };
      
      console.log(`✅ KML optimization completed: ${processed} files optimized`);
    } catch (error) {
      console.log(`⚠️ KML optimization failed: ${error.message}`);
      optimizationResult = {
        success: false,
        error: error.message
      };
      errors.push({
        step: 'KML_OPTIMIZATION',
        error: error.message,
        status: 'WARNING'
      });
    }
  }
  
  // Automatically update master metadata incrementally (only new files)
  let metadataResult = null;
  if (successfullyProcessed > 0) {
    try {
      // Get the renamed filenames from results (after SmartKMLManager processing)
      // We need to find the final renamed filenames from the uploads directory
      const newFilenames = [];
      
      for (const result of results) {
        if (result.status === 'success' && result.filename) {
          // Try to find the renamed file in uploads directory
          let filenameToUse = result.filename;
          const filePath = path.join(__dirname, '..', 'uploads', filenameToUse);
          
          if (!fs.existsSync(filePath)) {
            // File was renamed, try to find it by hash
            try {
              const files = fs.readdirSync(path.join(__dirname, '..', 'uploads'));
              const hashMatch = result.filename.match(/^([a-f0-9]{8})\.kml$/);
              if (hashMatch) {
                const hash = hashMatch[1];
                const matchingFile = files.find(f => f.includes(hash) && f.endsWith('.kml'));
                if (matchingFile) {
                  filenameToUse = matchingFile;
                }
              } else {
                // Try to construct the expected renamed filename from metadata
                // Format: YYYY-MM-DD-REG-HASH.kml
                if (result.date && result.registration) {
                  const expectedPattern = new RegExp(`^${result.date}-${result.registration.replace(/-/g, '')}-[a-f0-9]{8}\\.kml$`);
                  const matchingFile = files.find(f => expectedPattern.test(f));
                  if (matchingFile) {
                    filenameToUse = matchingFile;
                  }
                }
              }
            } catch (searchError) {
              console.log(`⚠️ Could not find renamed file for ${result.filename}: ${searchError.message}`);
            }
          }
          
          // Verify file exists before adding to list
          const finalPath = path.join(__dirname, '..', 'uploads', filenameToUse);
          if (fs.existsSync(finalPath)) {
            newFilenames.push(filenameToUse);
          }
        }
      }
      
      if (newFilenames.length > 0) {
        console.log(`🔄 Automatically updating master metadata incrementally for ${newFilenames.length} file(s)...`);
        metadataResult = await updateMasterMetadataIncremental(newFilenames);
        console.log('✅ Master metadata updated incrementally');
      } else {
        console.log('⚠️ No renamed files found to update metadata');
        metadataResult = {
          success: false,
          error: 'No renamed files found to update'
        };
      }
    } catch (error) {
      console.log(`⚠️ Incremental metadata update failed: ${error.message}`);
      metadataResult = {
        success: false,
        error: error.message
      };
      errors.push({
        step: 'METADATA_REFRESH',
        error: error.message,
        status: 'WARNING'
      });
    }
  }
  
  // Automatically rebuild static site after metadata update
  let buildResult = null;
  if (metadataResult && metadataResult.success) {
    try {
      console.log('🏗️ Automatically rebuilding static site with updated metadata...');
      buildResult = await buildStaticSite();
      if (buildResult.success) {
        console.log(`✅ Static site rebuilt successfully with ${buildResult.processed || 0} flights`);
      }
    } catch (error) {
      console.log(`⚠️ Static site build failed: ${error.message}`);
      buildResult = {
        success: false,
        error: error.message
      };
      errors.push({
        step: 'STATIC_SITE_BUILD',
        error: error.message,
        status: 'WARNING'
      });
    }
  }
  
  // Log what we're sending to frontend
  console.log('📤 Sending response to frontend:', {
    processed: successfullyProcessed,
    duplicates: duplicates,
    rejections: rejections,
    smartManager: smartManagerResults,
    optimization: optimizationResult,
    metadata: metadataResult,
    build: buildResult
  });
  
  // Return comprehensive results
  res.json({
    success: true,
    totalFiles: req.files.length,
    processed: successfullyProcessed,
    duplicates: duplicates,
    rejections: rejections,
    errors: errors.length,
    results: results,
    errors: errors,
    smartManager: smartManagerResults || null,
    optimization: optimizationResult || null,
    metadata: metadataResult || null,
    build: buildResult || null
  });
});

app.get('/uploads', (req, res) => {
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      return res.status(500).send('<h1>Error</h1><p>Unable to list uploads</p>');
    }
    // Only return .kml files
    const kmlFiles = files.filter(f => f.toLowerCase().endsWith('.kml'));
    const sortedFiles = kmlFiles.sort().reverse(); // Most recent first
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Uploaded KML Files</title>
          <style>
              body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
              .header { background: #e8f4f8; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
              .file-list { background: #f9f9f9; border-radius: 8px; padding: 20px; }
              .file-item { 
                  display: flex; 
                  justify-content: space-between; 
                  align-items: center; 
                  padding: 10px;
                  border-bottom: 1px solid #ddd;
                  transition: background-color 0.2s;
              }
              .file-item:hover { background-color: #f0f0f0; }
              .file-item:last-child { border-bottom: none; }
              .filename { font-weight: bold; flex-grow: 1; }
              .file-size { color: #666; margin-right: 15px; }
              .download-btn { 
                  background: #007bff; 
                  color: white; 
                  padding: 5px 15px; 
                  text-decoration: none; 
                  border-radius: 4px; 
                  font-size: 12px;
              }
              .download-btn:hover { background: #0056b3; }
              .stats { margin-bottom: 20px; color: #666; }
          </style>
      </head>
      <body>
          <div class="header">
              <h1>📁 Uploaded KML Files</h1>
              <p>All uploaded flight tracking KML files</p>
          </div>
          
          <div class="stats">
              <strong>Total Files:</strong> ${sortedFiles.length} KML files
          </div>
          
          <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 14px;">
              <strong>Legend:</strong>
              ⚠️ Yellow highlight = Incomplete/small files (may lack flight path data) |
              ❌ Red highlight = File access errors
          </div>
          
          <div class="file-list">
              ${sortedFiles.map(filename => {
                try {
                  const filePath = path.join(uploadsDir, filename);
                  const stats = fs.statSync(filePath);
                  
                  // Better file size formatting
                  let fileSize;
                  if (stats.size < 1024) {
                    fileSize = stats.size + ' B';
                  } else if (stats.size < 1024 * 1024) {
                    fileSize = (stats.size / 1024).toFixed(1) + ' KB';
                  } else {
                    fileSize = (stats.size / 1024 / 1024).toFixed(2) + ' MB';
                  }
                  
                  const uploadDate = stats.mtime.toISOString().split('T')[0];
                  
                  // Check for unusual files
                  const isUnknownDate = filename.startsWith('UNKNOWN-DATE');
                  const isVerySmall = stats.size < 5000; // Less than 5KB
                  const warningClass = (isUnknownDate || isVerySmall) ? ' style="background-color: #fff3cd; border-left-color: #ffc107;"' : '';
                  const warningIcon = (isUnknownDate || isVerySmall) ? '⚠️ ' : '';
                  
                  return `
                    <div class="file-item"${warningClass}>
                        <div class="filename">${warningIcon}${filename}</div>
                        <div class="file-size">${fileSize}</div>
                        <div class="file-date">${uploadDate}</div>
                        <a href="/uploads/${filename}" class="download-btn" target="_blank">Download</a>
                    </div>
                  `;
                } catch (e) {
                  return `
                    <div class="file-item" style="background-color: #f8d7da; border-left-color: #dc3545;">
                        <div class="filename">❌ ${filename}</div>
                        <div class="file-size">Error</div>
                        <div class="file-date">-</div>
                        <a href="/uploads/${filename}" class="download-btn" target="_blank">Download</a>
                    </div>
                  `;
                }
              }).join('')}
          </div>
          
          <div style="margin-top: 20px; text-align: center;">
              <a href="/" style="color: #007bff; text-decoration: none;">← Back to Upload Interface</a>
          </div>
      </body>
      </html>
    `;
    
    res.send(html);
  });
});

// HTML endpoint for metadata view
app.get('/metadata', (req, res) => {
  // Check if data is already enriched (from master file)
  const firstFlight = kmlMetadata[0];
  const isEnriched = firstFlight && (firstFlight.hasOwnProperty('owner') || firstFlight.hasOwnProperty('imageUrl'));
  
  let enrichedMetadata;
  if (isEnriched) {
    enrichedMetadata = kmlMetadata;
  } else {
    enrichedMetadata = kmlMetadata.map(flight => {
      const heliData = helicopterMetadata[flight.registration] || {};
      return {
        ...flight,
        owner: heliData.owner || '',
        contact: heliData.contact || '',
        imageUrl: heliData.imageUrl || ''
      };
    });
  }
  
  // Group by registration
  const flightsByReg = {};
  enrichedMetadata.forEach(flight => {
    if (!flightsByReg[flight.registration]) {
      flightsByReg[flight.registration] = [];
    }
    flightsByReg[flight.registration].push(flight);
  });
  
  const sortedRegs = Object.keys(flightsByReg).sort();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Flight Metadata</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1400px; margin: 0 auto; padding: 20px; }
            .header { background: #e8f4f8; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .stats { display: flex; gap: 30px; margin-bottom: 20px; }
            .stat-box { background: #f9f9f9; padding: 15px; border-radius: 8px; text-align: center; }
            .stat-number { font-size: 24px; font-weight: bold; color: #007bff; }
            .stat-label { font-size: 14px; color: #666; }
            .aircraft-section { background: white; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 20px; padding: 20px; }
            .aircraft-header { display: flex; align-items: center; margin-bottom: 15px; }
            .aircraft-reg { font-size: 20px; font-weight: bold; margin-right: 20px; }
            .aircraft-owner { color: #666; }
            .flights-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; }
            .flight-item { background: #f8f9fa; padding: 10px; border-radius: 4px; border-left: 4px solid #007bff; }
            .flight-date { font-weight: bold; }
            .flight-time { color: #666; font-size: 14px; }
            .flight-filename { font-size: 12px; color: #999; margin-top: 5px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>✈️ Flight Metadata</h1>
            <p>Flight tracking data by aircraft registration</p>
        </div>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-number">${enrichedMetadata.length}</div>
                <div class="stat-label">Total Flights</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">${sortedRegs.length}</div>
                <div class="stat-label">Aircraft</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">${new Set(enrichedMetadata.map(f => f.date)).size}</div>
                <div class="stat-label">Flight Days</div>
            </div>
        </div>
        
        ${sortedRegs.map(reg => {
          const flights = flightsByReg[reg].sort((a, b) => 
            new Date(b.date + ' ' + (b.time || '00:00')) - new Date(a.date + ' ' + (a.time || '00:00'))
          );
          const owner = flights[0].owner || 'Unknown';
          
          return `
            <div class="aircraft-section">
                <div class="aircraft-header">
                    <div class="aircraft-reg">${reg}</div>
                    <div class="aircraft-owner">${owner}</div>
                    <div style="margin-left: auto; color: #666;">${flights.length} flights</div>
                </div>
                <div class="flights-grid">
                    ${flights.slice(0, 20).map(flight => `
                      <div class="flight-item">
                          <div class="flight-date">${flight.date}</div>
                          <div class="flight-time">${flight.time || 'No time'}</div>
                          <div class="flight-filename">${flight.filename}</div>
                      </div>
                    `).join('')}
                    ${flights.length > 20 ? `<div class="flight-item" style="opacity: 0.7;">... and ${flights.length - 20} more flights</div>` : ''}
                </div>
            </div>
          `;
        }).join('')}
        
        <div style="margin-top: 20px; text-align: center;">
            <a href="/" style="color: #007bff; text-decoration: none;">← Back to Upload Interface</a>
        </div>
    </body>
    </html>
  `;
  
  res.send(html);
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

// Endpoint to add missing files to metadata (FAST)
app.post('/add-missing-metadata', async (req, res) => {
  try {
    console.log('🔍 Scanning for files missing from metadata...');
    
    // Get all KML files in uploads folder
    const allKmlFiles = fs.readdirSync(uploadsDir)
      .filter(f => f.toLowerCase().endsWith('.kml'))
      .sort();
    
    // Get existing filenames from metadata
    const existingFilenames = new Set(kmlMetadata.map(flight => flight.filename));
    
    // Find missing files
    const missingFiles = allKmlFiles.filter(filename => !existingFilenames.has(filename));
    
    console.log(`📊 Found ${allKmlFiles.length} total files, ${existingFilenames.size} in metadata`);
    console.log(`➕ Adding ${missingFiles.length} missing files to metadata`);
    
    let addedCount = 0;
    
    // Process each missing file
    for (const filename of missingFiles) {
      try {
        const filePath = path.join(uploadsDir, filename);
        const metadata = extractKmlInfoFromFile(filePath, filename);
        
        if (metadata.registration && metadata.registration !== 'UNKNOWN') {
          // Add to in-memory metadata
          kmlMetadata.push({
            filename: metadata.filename,
            registration: metadata.registration,
            date: metadata.date || 'UNKNOWN',
            time: metadata.time || 'UNKNOWN'
          });
          
          addedCount++;
          console.log(`✅ Added ${filename} (${metadata.registration}) to metadata`);
        } else {
          console.log(`⚠️ Skipped ${filename} - no valid registration found`);
        }
      } catch (error) {
        console.log(`❌ Error processing ${filename}: ${error.message}`);
      }
    }
    
    // Update master metadata file if it exists
    const masterFile = path.join(__dirname, '..', 'server', 'master-metadata.json');
    if (fs.existsSync(masterFile) && addedCount > 0) {
      try {
        const masterData = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
        if (masterData.flights) {
          masterData.flights = kmlMetadata;
          fs.writeFileSync(masterFile, JSON.stringify(masterData, null, 2));
          console.log(`💾 Updated master metadata file with ${addedCount} new entries`);
        }
      } catch (error) {
        console.log(`⚠️ Could not update master file: ${error.message}`);
      }
    }
    
    // Clear cache so it gets regenerated
    const cacheFile = path.join(__dirname, '..', 'server', 'kml-metadata-cache.json');
    if (fs.existsSync(cacheFile)) {
      try {
        fs.unlinkSync(cacheFile);
        console.log(`🗑️ Cleared cache for regeneration`);
      } catch (e) {
        console.log(`⚠️ Could not clear cache: ${e.message}`);
      }
    }
    
    res.json({
      success: true,
      message: `Added ${addedCount} missing files to metadata`,
      added: addedCount,
      total: kmlMetadata.length,
      details: {
        totalFiles: allKmlFiles.length,
        previousMetadataCount: existingFilenames.size,
        newMetadataCount: kmlMetadata.length
      }
    });
    
  } catch (error) {
    console.log(`❌ Error adding missing metadata: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to refresh KML metadata (NO AUTH required) - FULL RESCAN
app.post('/refresh-metadata', (req, res) => {
  // Force full rescan by deleting cache
  const cacheFile = path.join(__dirname, '..', 'server', 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      fs.unlinkSync(cacheFile);
      console.log(`🗑️ Deleted cache for full rescan`);
    } catch (e) {
      console.log(`❌ Error deleting cache: ${e.message}`);
    }
  }
  
  scanKmlMetadata();
  res.json({ success: true, message: 'Metadata refresh started' });
});

// Helper function to run KML optimization script
function optimizeKMLFiles(specificFile = null) {
  return new Promise((resolve, reject) => {
    console.log('🔧 Starting KML optimization process...');
    
    const pythonScript = path.join(__dirname, 'optimise_kml.py');
    const inputDir = path.join(__dirname, '..', 'uploads');
    const outputDir = path.join(__dirname, '../../static-site/kml-optimised');
    
    // Check if Python script exists
    if (!fs.existsSync(pythonScript)) {
      const error = 'Python optimization script not found';
      console.log(`❌ ${error}`);
      return reject(new Error(error));
    }
    
    // Modify the Python script temporarily if we need to process a specific file
    const python = spawn('python3', [pythonScript], {
      cwd: path.dirname(pythonScript),
      env: { ...process.env, UPLOADS_DIR: inputDir, OUTPUT_DIR: outputDir }
    });
    
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('🐍 Python:', data.toString().trim());
    });
    
    python.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('🐍 Python Error:', data.toString().trim());
    });
    
    python.on('close', (code) => {
      if (code === 0) {
        console.log('✅ KML optimization completed successfully');
        resolve({ stdout, stderr, code });
      } else {
        console.log(`❌ Python script exited with code ${code}`);
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
      }
    });
    
    python.on('error', (error) => {
      console.log(`❌ Failed to start Python script: ${error.message}`);
      reject(error);
    });
  });
}

// Helper function to regenerate master metadata (full scan)
function generateMasterMetadata() {
  return new Promise((resolve, reject) => {
    console.log('🔄 Starting master metadata generation...');
    
    const scriptPath = path.join(__dirname, 'generate-master-metadata-main.cjs');
    
    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      const error = 'Master metadata generation script not found';
      console.log(`❌ ${error}`);
      return reject(new Error(error));
    }
    
    const child = spawn('node', [scriptPath], {
      cwd: __dirname,
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log('📊 Master metadata:', text.trim());
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.log('⚠️ Master metadata error:', text.trim());
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        // Try to read the generated metadata to get flight count
        const masterFile = path.join(__dirname, 'master-metadata.json');
        let flightCount = 0;
        if (fs.existsSync(masterFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
            flightCount = data.flights ? data.flights.length : 0;
          } catch (e) {
            console.log('Could not read flight count:', e.message);
          }
        }
        
        console.log('✅ Master metadata regenerated successfully');
        resolve({
          success: true,
          flightCount: flightCount,
          message: 'Master metadata regenerated successfully'
        });
      } else {
        console.log(`❌ Metadata generation failed with exit code ${code}`);
        reject(new Error(`Metadata generation failed with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      console.log(`❌ Failed to start metadata generation script: ${error.message}`);
      reject(error);
    });
  });
}

// Helper function to incrementally update master metadata (only new files)
async function updateMasterMetadataIncremental(newFilenames) {
  try {
    const { updateMasterMetadataIncremental: updateFn } = require('./generate-master-metadata-main.cjs');
    const result = await updateFn(newFilenames);
    
    return {
      success: true,
      flightCount: result.flights ? result.flights.length : 0,
      message: `Master metadata updated incrementally: ${newFilenames.length} file(s) processed`
    };
  } catch (error) {
    console.log(`❌ Incremental metadata update error: ${error.message}`);
    throw error;
  }
}

// Helper function to build static site
function buildStaticSite() {
  return new Promise((resolve, reject) => {
    console.log('🏗️ Starting static site build...');
    
    const buildScript = path.join(__dirname, 'build-static-site.cjs');
    
    // Check if script exists
    if (!fs.existsSync(buildScript)) {
      const error = 'Static site build script not found';
      console.log(`❌ ${error}`);
      return reject(new Error(error));
    }
    
    const nodeProcess = spawn('node', [buildScript], {
      cwd: path.join(__dirname, '..', '..'), // Run from project root
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    nodeProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log('🏗️ Build:', output.trim());
    });
    
    nodeProcess.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.log('⚠️ Build error:', output.trim());
    });
    
    nodeProcess.on('close', (code) => {
      if (code === 0) {
        // Parse the output to extract processed count
        const processedMatch = stdout.match(/📊 Loaded (\d+) flights/);
        const generatedMatch = stdout.match(/Copied (\d+) optimized KML files/);
        const processed = processedMatch ? parseInt(processedMatch[1]) : 0;
        const generated = generatedMatch ? parseInt(generatedMatch[1]) : 0;
        
        console.log(`✅ Static site build completed successfully. Processed: ${processed} flights`);
        resolve({
          success: true,
          processed: processed,
          generated: generated,
          message: `Static site built successfully with ${processed} flights`
        });
      } else {
        console.log(`❌ Static site build failed with exit code ${code}`);
        reject(new Error(`Static site build failed with code ${code}: ${stderr}`));
      }
    });
    
    nodeProcess.on('error', (error) => {
      console.log(`❌ Failed to start static site build script: ${error.message}`);
      reject(error);
    });
  });
}

// Endpoint to regenerate master metadata
app.post('/regenerate-master-metadata', async (req, res) => {
  try {
    console.log('🔄 Regenerating master metadata from all KML files...');
    
    // Run the master metadata generation script
    const { spawn } = require('child_process');
    const scriptPath = path.join(__dirname, 'generate-master-metadata-main.cjs');
    
    return new Promise((resolve) => {
      const child = spawn('node', [scriptPath], {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log('📊 Master metadata:', text.trim());
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.log('⚠️ Master metadata error:', text.trim());
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          // Try to read the generated metadata to get flight count
          const masterFile = path.join(__dirname, 'master-metadata.json');
          let flightCount = 0;
          if (fs.existsSync(masterFile)) {
            try {
              const data = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
              flightCount = data.flights ? data.flights.length : 0;
            } catch (e) {
              console.log('Could not read flight count:', e.message);
            }
          }
          
          console.log('✅ Master metadata regenerated successfully');
          res.json({
            success: true,
            message: 'Master metadata regenerated successfully',
            flightCount: flightCount
          });
          resolve();
        } else {
          console.log(`❌ Master metadata generation failed with code ${code}`);
          res.status(500).json({
            success: false,
            error: `Generation failed with code ${code}: ${stderr}`
          });
          resolve();
        }
      });
      
      child.on('error', (error) => {
        console.log(`❌ Failed to run master metadata generation: ${error.message}`);
        res.status(500).json({
          success: false,
          error: error.message
        });
        resolve();
      });
    });
  } catch (error) {
    console.log(`❌ Master metadata generation error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to run Smart KML Manager processing
app.post('/process-kmls', async (req, res) => {
  try {
    console.log('🧠 Running Smart KML Manager processing...');
    const manager = new SmartKMLManager();
    const results = await manager.processNewFiles();
    
    res.json({
      success: true,
      message: 'KML processing completed',
      results: results
    });
  } catch (error) {
    console.log(`❌ Smart KML Manager error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to optimize KML files (create optimized versions)
app.post('/optimize-kmls', async (req, res) => {
  try {
    const result = await optimizeKMLFiles();
    
    res.json({
      success: true,
      message: 'KML optimization completed successfully',
      output: result.stdout
    });
  } catch (error) {
    console.log(`❌ KML optimization error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Validation endpoint to check KML files, optimized files, and PNG images
app.get('/validate-files', async (req, res) => {
  try {
    const validateUploadsDir = path.join(__dirname, '..', 'uploads');
    const optimizedDir = path.join(__dirname, '../../static-site/kml-optimised');
    const pngDir = path.join(__dirname, '..', 'flight-maps');
    
    // Get all KML files in uploads directory
    const uploadFiles = fs.readdirSync(validateUploadsDir)
      .filter(f => f.toLowerCase().endsWith('.kml'));
    
    // Get all optimized KML files
    const optimizedFiles = fs.existsSync(optimizedDir) ? 
      fs.readdirSync(optimizedDir).filter(f => f.toLowerCase().endsWith('-opt.kml')) : [];
    
    // Get all PNG files in flight-maps directory
    const pngFiles = fs.existsSync(pngDir) ? 
      fs.readdirSync(pngDir).filter(f => f.toLowerCase().endsWith('.png')) : [];
    
    // Check which original files have optimized versions
    const missingOptimized = [];
    const missingPNG = [];
    const orphanedOptimized = [];
    
    // Create a set of original file basenames for fast lookup
    const originalBaseNames = new Set(uploadFiles.map(f => f.replace('.kml', '')));
    
    uploadFiles.forEach(file => {
      // Check for optimized version (original.kml → original-opt.kml)
      const baseName = file.replace('.kml', '');
      const expectedOptFile = `${baseName}-opt.kml`;
      if (!optimizedFiles.includes(expectedOptFile)) {
        missingOptimized.push(file);
      }
      
      // Check for PNG version (original.kml → original.png)
      const expectedPngFile = `${baseName}.png`;
      if (!pngFiles.includes(expectedPngFile)) {
        missingPNG.push(file);
      }
    });
    
    // Find orphaned optimized files (optimized files without corresponding originals)
    optimizedFiles.forEach(optFile => {
      const baseName = optFile.replace('-opt.kml', '');
      if (!originalBaseNames.has(baseName)) {
        orphanedOptimized.push(optFile);
      }
    });
    
    // Add health check for backend vs frontend sync
    let healthCheck = null;
    try {
      const frontendParser = new FrontendParser();
      healthCheck = await frontendParser.getHealthSummary();
      console.log('✅ Health check completed:', healthCheck.summary);
    } catch (healthError) {
      console.warn('⚠️ Health check failed:', healthError.message);
      healthCheck = {
        success: false,
        error: healthError.message,
        status: 'error',
        statusIcon: '❌',
        statusColor: 'error',
        summary: 'Health check failed - unable to compare backend and frontend data'
      };
    }
    
    res.json({
      success: true,
      counts: {
        uploads: uploadFiles.length,
        optimized: optimizedFiles.length,
        pngImages: pngFiles.length,
        orphanedOptimized: orphanedOptimized.length
      },
      missing: {
        optimized: missingOptimized,
        png: missingPNG,
        orphanedOptimized: orphanedOptimized
      },
      paths: {
        uploadsDir: validateUploadsDir,
        optimizedDir,
        pngDir
      },
      healthCheck: healthCheck
    });
  } catch (error) {
    console.log(`❌ Validation error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Generate missing PNG files endpoint
app.post('/generate-missing-pngs', async (req, res) => {
  try {
    console.log('🖼️ Generating missing PNG images for existing KML files...');
    
    const uploadsDir = path.join(__dirname, '../uploads');
    const flightMapsDir = path.join(__dirname, '..', 'flight-maps');
    const generateScript = path.join(__dirname, 'generate-flight-image.cjs');
    
    // Get list of KML files in uploads directory
    const kmlFiles = fs.readdirSync(uploadsDir)
      .filter(file => file.endsWith('.kml'))
      .map(file => path.basename(file, '.kml')); // Remove .kml extension for comparison
    
    console.log(`📁 Found ${kmlFiles.length} KML files to check`);
    
    let processed = 0;
    let errors = 0;
    const errorDetails = [];
    
    // Check each KML file for corresponding PNG
    for (const kmlBase of kmlFiles) {
      const kmlFile = `${kmlBase}.kml`;
      const expectedPngPath = path.join(flightMapsDir, `${kmlBase}.png`);
      
      // Check if PNG already exists
      if (!fs.existsSync(expectedPngPath)) {
        console.log(`🖼️ Generating PNG for: ${kmlFile}`);
        
        try {
          const { spawn } = require('child_process');
          
          const nodeProcess = spawn('node', [generateScript, kmlFile], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          
          let stdout = '';
          let stderr = '';
          
          nodeProcess.stdout.on('data', (data) => {
            stdout += data.toString();
          });
          
          nodeProcess.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          
          await new Promise((resolve, reject) => {
            nodeProcess.on('close', (code) => {
              if (code === 0) {
                console.log(`✅ Generated PNG for: ${kmlFile}`);
                processed += 1;
              } else {
                console.log(`❌ Failed to generate PNG for ${kmlFile}`);
                errors += 1;
                errorDetails.push(`${kmlFile}: ${stderr || 'Unknown error'}`);
              }
              resolve();
            });
          });
          
        } catch (error) {
          console.log(`❌ PNG generation error: ${error.message}`);
          errors += 1;
          errorDetails.push(`${kmlFile}: ${error.message}`);
        }
      }
    }
    
    console.log(`✅ PNG generation completed - processed: ${processed}, errors: ${errors}`);
    
    res.json({
      success: true,
      processed: processed,
      errors: errors,
      message: `Generated ${processed} PNG files. ${errors > 0 ? `Error in PNG generation: ${errorDetails.join(', ')}` : 'All PNGs generated successfully.'}`,
      errorDetails: errorDetails.length > 0 ? errorDetails : null
    });
    
  } catch (error) {
    console.log(`❌ PNG generation error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Optimize KML files endpoint
app.post('/optimize-kmls', async (req, res) => {
  try {
    console.log('🔧 Starting KML optimization...');
    
    // Run the Python optimization script
    const pythonScript = path.join(__dirname, 'optimise_kml.py');
    const { spawn } = require('child_process');
    
    const python = spawn('python3', [pythonScript], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    python.on('close', (code) => {
      if (code === 0) {
        // Parse the output to extract processed count
        const processedMatch = stdout.match(/Successfully processed:\s*(\d+)/);
        const processed = processedMatch ? parseInt(processedMatch[1]) : 0;
        
        console.log(`✅ Optimization completed successfully. Processed: ${processed} files`);
        res.json({
          success: true,
          processed: processed,
          message: 'KML optimization completed successfully'
        });
      } else {
        console.log(`❌ Optimization failed with exit code: ${code}`);
        console.log(`Stdout: ${stdout}`);
        console.log(`Stderr: ${stderr}`);
        res.status(500).json({
          success: false,
          error: `Optimization failed (exit code: ${code})`,
          details: stderr
        });
      }
    });
    
    python.on('error', (error) => {
      console.log(`❌ Failed to start optimization script: ${error.message}`);
      res.status(500).json({
        success: false,
        error: `Failed to start optimization: ${error.message}`
      });
    });
    
  } catch (error) {
    console.log(`❌ Optimization error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    flights: kmlMetadata.length,
    helicopters: Object.keys(helicopterMetadata).length,
    timestamp: new Date().toISOString(),
    auth: 'disabled'
  });
});

// Ready check (for deployment health checks)
app.get('/ready', (req, res) => {
  if (kmlMetadata.length > 0) {
    res.json({
      status: 'ready',
      flights: kmlMetadata.length,
      helicopters: Object.keys(helicopterMetadata).length
    });
  } else {
    res.status(503).json({
      status: 'loading',
      message: 'Still scanning KML files'
    });
  }
});

// Test API endpoint
app.get('/test', (req, res) => {
  const testHtml = fs.readFileSync(path.join(__dirname, '../test-api.html'), 'utf8');
  res.send(testHtml);
});

// Admin interface: serve the enhanced UI from backend.html
app.get('/', (req, res) => {
  const adminPath = path.join(__dirname, '..', 'backend.html');
  res.sendFile(adminPath);
});

// Also make it available at /admin
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, '..', 'backend.html');
  res.sendFile(adminPath);
});

// Build static site endpoint
app.post('/build-static-site', async (req, res) => {
  try {
    console.log('🏗️ Starting static site build...');
    
    // Run the static site build script
    const buildScript = path.join(__dirname, 'build-static-site.cjs');
    const { spawn } = require('child_process');
    
    const nodeProcess = spawn('node', [buildScript], {
      cwd: path.join(__dirname, '..', '..'), // Run from project root
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    nodeProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      stdout += output;
    });
    
    nodeProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(output);
      stderr += output;
    });
    
    nodeProcess.on('close', (code) => {
      if (code === 0) {
        // Parse the output to extract processed count
        const processedMatch = stdout.match(/📊 Loaded (\d+) flights/);
        const generatedMatch = stdout.match(/Copied (\d+) optimized KML files/);
        const processed = processedMatch ? parseInt(processedMatch[1]) : 0;
        const generated = generatedMatch ? parseInt(generatedMatch[1]) : 0;
        
        console.log(`✅ Static site build completed successfully. Processed: ${processed} flights, Generated: ${generated} optimized files`);
        res.json({
          success: true,
          processed: processed,
          generated: generated,
          message: 'Static site built successfully'
        });
      } else {
        console.log(`❌ Static site build failed with exit code: ${code}`);
        console.log(`Stdout: ${stdout}`);
        console.log(`Stderr: ${stderr}`);
        res.status(500).json({
          success: false,
          error: `Static site build failed (exit code: ${code})`,
          details: stderr
        });
      }
    });
    
    nodeProcess.on('error', (error) => {
      console.log(`❌ Failed to start static site build script: ${error.message}`);
      res.status(500).json({
        success: false,
        error: `Failed to start static site build: ${error.message}`
      });
    });
                    
                } catch (error) {
    console.log(`❌ Static site build error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Global deployment instance
let currentDeployer = null;

// Deploy to GitHub endpoint
app.post('/api/deploy-to-github', async (req, res) => {
  try {
    if (currentDeployer) {
      return res.status(409).json({
        success: false,
        error: 'Deployment already in progress',
        status: await currentDeployer.getStatus()
      });
    }

    console.log('🚀 Starting GitHub deployment...');
    currentDeployer = new GitDeployer();
    
    // Start deployment asynchronously
    currentDeployer.deploy()
      .then(result => {
        console.log('✅ Deployment completed:', result);
        setTimeout(() => {
          currentDeployer = null; // Clear deployer after 30 seconds
        }, 30000);
      })
      .catch(error => {
        console.error('❌ Deployment failed:', error.message);
        setTimeout(() => {
          currentDeployer = null; // Clear deployer after 30 seconds even on error
        }, 30000);
      });

    res.json({
      success: true,
      message: 'Deployment started',
      status: await currentDeployer.getStatus()
    });

  } catch (error) {
    console.error('❌ Deploy endpoint error:', error.message);
    currentDeployer = null;
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Deployment status endpoint
app.get('/api/deployment-status', async (req, res) => {
  try {
    if (currentDeployer) {
      const status = await currentDeployer.getStatus();
      res.json({ success: true, status });
    } else {
      // Try to read status from file if no active deployer
      try {
        const statusFile = path.join(__dirname, '..', 'config', 'deployment-status.json');
        if (fs.existsSync(statusFile)) {
          const fileStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          res.json({ success: true, status: fileStatus });
                    } else {
          res.json({ 
            success: true, 
            status: { 
              stage: 'idle', 
              message: 'No deployment in progress', 
              progress: 0,
              error: null 
            } 
          });
                    }
                } catch (error) {
        res.json({ 
          success: true, 
          status: { 
            stage: 'idle', 
            message: 'No deployment in progress', 
            progress: 0,
            error: null 
          } 
        });
      }
                    }
                } catch (error) {
    console.error('❌ Status endpoint error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get pending files for deployment
app.get('/api/pending-deployment-files', async (req, res) => {
  try {
    const deployer = new GitDeployer();
    const newFiles = await deployer.getNewFiles();
    
    // Group files by type
    const summary = {
      'kml-original': [],
      'png-map': [],
      'kml-optimised': [],
      'other': []
    };
    
    newFiles.forEach(file => {
      summary[file.type].push({
        path: file.path,
        status: file.status,
        name: path.basename(file.path)
      });
    });
    
    const registrations = deployer.extractRegistrationsFromFiles(newFiles);
    
    res.json({
      success: true,
      totalFiles: newFiles.length,
      summary,
      registrations
    });
    
  } catch (error) {
    console.error('❌ Pending files endpoint error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const OPEN_ON_START = process.env.OPEN_ADMIN === 'true' || process.argv.includes('--open');

app.listen(PORT, () => {
  console.log(`🚀 Admin server running at http://localhost:${PORT}`);
  console.log(`🔓 Authentication: DISABLED (local development mode)`);
  console.log(`📁 Upload directory: ${uploadsDir}`);
  console.log(`✈️  Flights loaded: ${kmlMetadata.length}`);
  console.log(`🚁 Helicopters in database: ${Object.keys(helicopterMetadata).length}`);
  console.log(`\n💡 Admin interface: http://localhost:${PORT} (serving backend.html)`);
  console.log(`🛑 Press Ctrl+C to stop the server`);

  if (OPEN_ON_START) {
    const url = `http://localhost:${PORT}`;
    try {
      const { spawn } = require('child_process');
      const platform = process.platform;
      if (platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      else if (platform === 'win32') spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
      else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
      console.log(`🌐 Opened ${url} in your default browser (set OPEN_ADMIN=false to disable)`);
    } catch (e) {
      console.log(`ℹ️ Could not auto-open browser: ${e.message}`);
    }
  }
});
