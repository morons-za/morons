const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Load the same functions...
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
      const inner = [];
      
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
        polygons.push({ outer, inner });
      }
    }
    
    function findPolygons(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      if (obj.Polygon) {
        const polygonElements = Array.isArray(obj.Polygon) ? obj.Polygon : [obj.Polygon];
        for (const polygon of polygonElements) {
          processPolygon(polygon);
        }
      }
      
      if (obj.MultiGeometry && obj.MultiGeometry.Polygon) {
        const polygonElements = Array.isArray(obj.MultiGeometry.Polygon) ? obj.MultiGeometry.Polygon : [obj.MultiGeometry.Polygon];
        for (const polygon of polygonElements) {
          processPolygon(polygon);
        }
      }
      
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

function pointInTMNP(lat, lon, tmnpPolygons) {
  if (!tmnpPolygons || tmnpPolygons.length === 0) return false;
  
  for (const polygon of tmnpPolygons) {
    const inOuter = pointInPolygon([lon, lat], polygon.outer);
    
    if (inOuter) {
      let inHole = false;
      for (const hole of polygon.inner) {
        if (pointInPolygon([lon, lat], hole)) {
          inHole = true;
          break;
        }
      }
      
      if (!inHole) {
        return true;
      }
    }
  }
  
  return false;
}

// Load some coordinates from an accepted KML file and test them ALL
function extractAllCoordinates(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(xmlData);
  
  const coordinates = [];
  
  function extractCoords(obj) {
    if (!obj || typeof obj !== 'object') return;
    
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
    
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        extractCoords(obj[key]);
      }
    }
  }
  
  extractCoords(xml);
  return coordinates;
}

// Test with an accepted file
console.log('🔍 Deep violation test...\n');

const tmnpPolygons = loadTMNPCoordinates();
console.log(`🗺️ Loaded ${tmnpPolygons.length} TMNP polygon(s)`);

// Show TMNP boundary limits
const allBoundaryPoints = [];
tmnpPolygons.forEach(polygon => {
  allBoundaryPoints.push(...polygon.outer);
});

if (allBoundaryPoints.length > 0) {
  const lats = allBoundaryPoints.map(p => p[1]);
  const lons = allBoundaryPoints.map(p => p[0]);
  console.log(`📍 TMNP boundary covers:`);
  console.log(`   Latitude: ${Math.min(...lats).toFixed(6)} to ${Math.max(...lats).toFixed(6)}`);
  console.log(`   Longitude: ${Math.min(...lons).toFixed(6)} to ${Math.max(...lons).toFixed(6)}`);
}

// Test with a file that should have violations
const acceptedFile = 'uploads/2025-03-26-ZS-HBO-399fed56.kml';
console.log(`\n🧪 Testing ALL coordinates from accepted file: ${acceptedFile}`);

const coords = extractAllCoordinates(acceptedFile);
console.log(`📊 Found ${coords.length} coordinates`);

let violationCount = 0;
let testedCount = 0;

// Test every 50th coordinate to avoid spam
for (let i = 0; i < coords.length; i += 50) {
  const coord = coords[i];
  const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
  if (isViolation) {
    violationCount++;
    console.log(`🚁 VIOLATION at index ${i}: lat=${coord.lat}, lon=${coord.lon}`);
  }
  testedCount++;
}

console.log(`\n📊 Results:`);
console.log(`   Tested: ${testedCount} coordinates (every 50th)`);
console.log(`   Violations found: ${violationCount}`);
console.log(`   Violation rate: ${((violationCount/testedCount)*100).toFixed(1)}%`);

if (violationCount === 0) {
  console.log(`\n❓ No violations found in accepted file - this suggests a problem with:`);
  console.log(`   1. The TMNP boundary data might be incorrect`);
  console.log(`   2. The point-in-polygon algorithm might have issues`);
  console.log(`   3. The coordinate system/projection might be wrong`);
  console.log(`   4. The accepted files might not actually contain violations`);
}
