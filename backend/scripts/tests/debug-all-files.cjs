const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const filesToAnalyze = [
  '/Users/werner/Downloads/KMLs to be uploaded/3bfd81ed.kml',
  '/Users/werner/Downloads/KMLs to be uploaded/3bfd2106.kml',
  '/Users/werner/Downloads/KMLs to be uploaded/3bfdba0f.kml',
  '/Users/werner/Downloads/KMLs to be uploaded/3c0bf893.kml',
  '/Users/werner/Downloads/KMLs to be uploaded/3c0c66b9.kml',
  '/Users/werner/Downloads/KMLs to be uploaded/3c0c461d.kml'
];

// Load TMNP boundary coordinates from KML file
function loadTMNPCoordinates() {
  try {
    const kmlPath = path.join(__dirname, '..', '..', '..', 'static-site', 'tmnp.kml');
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    const polygons = [];
    
    function processPolygon(polygonObj) {
      if (!polygonObj || !polygonObj.outerBoundaryIs) return;
      
      const outer = [];
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
      
      if (outer.length > 0) {
        polygons.push({ outer, inner: [] });
      }
    }
    
    const doc = xml.kml.Document;
    if (doc.Placemark) {
      const placemarks = Array.isArray(doc.Placemark) ? doc.Placemark : [doc.Placemark];
      for (const placemark of placemarks) {
        if (placemark.Polygon) {
          processPolygon(placemark.Polygon);
        } else if (placemark.MultiGeometry && placemark.MultiGeometry.Polygon) {
          const polygonList = Array.isArray(placemark.MultiGeometry.Polygon) 
            ? placemark.MultiGeometry.Polygon 
            : [placemark.MultiGeometry.Polygon];
          for (const polygon of polygonList) {
            processPolygon(polygon);
          }
        }
      }
    }
    
    return polygons;
  } catch (error) {
    console.error('❌ Error loading TMNP boundary:', error.message);
    return [];
  }
}

function pointInPolygon(lat, lon, polygon) {
  const x = lon, y = lat;
  let inside = false;
  
  const poly = polygon.outer;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

function pointInTMNP(lat, lon, tmnpPolygons) {
  for (const polygon of tmnpPolygons) {
    if (pointInPolygon(lat, lon, polygon)) {
      return true;
    }
  }
  return false;
}

function extractKmlCoordinates(filePath) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    
    const coordinates = [];
    
    function extractCoords(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      // Check for LineString coordinates (flight path format)
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
    return coordinates;
    
  } catch (error) {
    console.error(`❌ Error parsing ${filePath}:`, error.message);
    return [];
  }
}

function extractMetadata(filePath) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    
    let registration = '';
    let date = '';
    
    // Extract from document name
    if (xml.kml && xml.kml.Document && xml.kml.Document.name) {
      const name = xml.kml.Document.name;
      const regMatch = name.match(/([A-Z]{2}[A-Z0-9]{3})$/);
      if (regMatch) {
        const rawReg = regMatch[1];
        registration = rawReg.slice(0, 2) + '-' + rawReg.slice(2);
      }
    }
    
    // Extract date from first timestamp
    function findFirstTimestamp(obj) {
      if (!obj || typeof obj !== 'object') return null;
      
      if (obj.TimeStamp && obj.TimeStamp.when) {
        return obj.TimeStamp.when;
      }
      
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const found = findFirstTimestamp(obj[key]);
          if (found) return found;
        }
      }
      return null;
    }
    
    const timestamp = findFirstTimestamp(xml);
    if (timestamp) {
      const dateMatch = timestamp.match(/(\\d{4}-\\d{2}-\\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
      }
    }
    
    return { registration, date };
    
  } catch (error) {
    console.error(`❌ Error extracting metadata from ${filePath}:`, error.message);
    return { registration: 'UNKNOWN', date: 'UNKNOWN' };
  }
}

// Main analysis
console.log('🔍 Analyzing All 6 KML Files');
console.log('============================\\n');

const tmnpPolygons = loadTMNPCoordinates();

if (tmnpPolygons.length === 0) {
  console.log('❌ No TMNP polygons loaded - exiting');
  process.exit(1);
}

let violatingFiles = 0;
let nonViolatingFiles = 0;

for (const filePath of filesToAnalyze) {
  console.log(`\\n📄 Analyzing: ${path.basename(filePath)}`);
  console.log('================================================');
  
  if (!fs.existsSync(filePath)) {
    console.log('❌ File not found!');
    continue;
  }
  
  // Extract metadata
  const metadata = extractMetadata(filePath);
  console.log(`✈️  Registration: ${metadata.registration}`);
  console.log(`📅 Date: ${metadata.date}`);
  
  // Extract coordinates
  const coordinates = extractKmlCoordinates(filePath);
  console.log(`📍 Found ${coordinates.length} coordinate points`);
  
  if (coordinates.length === 0) {
    console.log('⚠️  No coordinates found in file');
    continue;
  }
  
  // Show coordinate range
  const lats = coordinates.map(c => c.lat);
  const lons = coordinates.map(c => c.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  
  console.log(`🗺️  Coordinate bounds:`);
  console.log(`   Latitude: ${minLat.toFixed(6)} to ${maxLat.toFixed(6)}`);
  console.log(`   Longitude: ${minLon.toFixed(6)} to ${maxLon.toFixed(6)}`);
  
  // Test first few coordinates for violations
  let hasViolations = false;
  let violationCount = 0;
  
  console.log(`\\n🚁 Testing first 10 coordinates for TMNP violations:`);
  for (let i = 0; i < Math.min(10, coordinates.length); i++) {
    const coord = coordinates[i];
    const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    console.log(`   [${i+1}] lat=${coord.lat}, lon=${coord.lon} -> ${isViolation ? '✅ VIOLATION' : '❌ NO VIOLATION'}`);
    
    if (isViolation) {
      hasViolations = true;
      violationCount++;
    }
  }
  
  // Test ALL coordinates for violations (for summary)
  let totalViolations = 0;
  for (const coord of coordinates) {
    if (pointInTMNP(coord.lat, coord.lon, tmnpPolygons)) {
      totalViolations++;
    }
  }
  
  console.log(`\\n📊 Summary: ${totalViolations}/${coordinates.length} points are violations (${(totalViolations/coordinates.length*100).toFixed(1)}%)`);
  
  if (totalViolations > 0) {
    console.log('🚨 RESULT: This flight SHOULD BE ACCEPTED (contains violations)');
    violatingFiles++;
  } else {
    console.log('✅ RESULT: This flight should be rejected (no violations)');
    nonViolatingFiles++;
  }
}

console.log(`\\n\\n📈 OVERALL SUMMARY`);
console.log(`==================`);
console.log(`Files with violations: ${violatingFiles}`);
console.log(`Files without violations: ${nonViolatingFiles}`);
console.log(`Total files analyzed: ${violatingFiles + nonViolatingFiles}`);

if (violatingFiles > 0) {
  console.log(`\\n🚨 BUG CONFIRMED: ${violatingFiles} files contain TMNP violations but were rejected!`);
  console.log('The upload system has a bug that needs to be fixed.');
} else {
  console.log(`\\n✅ System working correctly: All files contain no violations and were correctly rejected.`);
}