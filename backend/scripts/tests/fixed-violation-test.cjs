const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Load TMNP boundary coordinates
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

// Extract coordinates from Point format (FIXED)
function extractAllCoordinates(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(xmlData);
  
  const coordinates = [];
  
  function extractCoords(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Check for Point coordinates (this is the format both files use)
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
    
    // Also check for gx:Track just in case
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
    
    // Recursively search
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        extractCoords(obj[key]);
      }
    }
  }
  
  extractCoords(xml);
  return coordinates;
}

// Test with both files
console.log('🔍 FIXED violation test...\n');

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

console.log('\n🧪 Testing BOTH files:');

// Test files
const files = [
  { name: '✅ Accepted file', path: 'uploads/2025-03-26-ZS-HBO-399fed56.kml', expected: 'Should have violations' },
  { name: '❌ Rejected file', path: '/Users/werner/Downloads/KMLs to be uploaded/3bfd81ed.kml', expected: 'Being rejected (no violations?)' }
];

for (const file of files) {
  console.log(`\n${file.name}: ${file.path}`);
  console.log(`   Expected: ${file.expected}`);
  
  const coords = extractAllCoordinates(file.path);
  console.log(`   📊 Found ${coords.length} coordinates`);
  
  if (coords.length === 0) {
    console.log('   ❌ No coordinates found - extraction failed!');
    continue;
  }
  
  let violationCount = 0;
  let testedCount = 0;
  
  // Test every 100th coordinate to avoid spam, but show first few violations
  const sampleRate = Math.max(1, Math.floor(coords.length / 20)); // Test ~20 points
  let violationsShown = 0;
  
  for (let i = 0; i < coords.length; i += sampleRate) {
    const coord = coords[i];
    const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    if (isViolation) {
      violationCount++;
      if (violationsShown < 3) {
        console.log(`   🚁 VIOLATION at index ${i}: lat=${coord.lat}, lon=${coord.lon}`);
        violationsShown++;
      }
    }
    testedCount++;
  }
  
  console.log(`   📊 Tested: ${testedCount} coordinates (every ${sampleRate}th)`);
  console.log(`   🚁 Violations found: ${violationCount}`);
  console.log(`   📈 Violation rate: ${((violationCount/testedCount)*100).toFixed(1)}%`);
  
  if (violationCount === 0) {
    console.log(`   ⚠️ NO VIOLATIONS DETECTED - Testing first few coordinates manually:`);
    for (let i = 0; i < Math.min(5, coords.length); i++) {
      const coord = coords[i];
      const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
      console.log(`     ${i+1}: lat=${coord.lat}, lon=${coord.lon} -> ${isViolation ? '🚁 VIOLATION' : '✅ No violation'}`);
    }
  }
}
