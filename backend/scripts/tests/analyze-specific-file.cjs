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

function extractAllCoordinates(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(xmlData);
  
  const coordinates = [];
  
  function extractCoords(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Check for Point coordinates
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
    
    // Check for gx:Track coordinates 
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
    
    // Check for LineString coordinates
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

// Analyze the specific file
const targetFile = path.join(__dirname, '..', '..', 'uploads', '3be1939b.kml');

console.log('🔍 ANALYZING SPECIFIC FILE: 3be1939b.kml\n');

// Load TMNP boundary
const tmnpPolygons = loadTMNPCoordinates();
console.log(`🗺️ Loaded ${tmnpPolygons.length} TMNP polygon(s)`);

// Extract coordinates
console.log(`📄 Extracting coordinates from: ${targetFile}`);
const coords = extractAllCoordinates(targetFile);
console.log(`📊 Found ${coords.length} coordinate points\n`);

if (coords.length === 0) {
  console.log('❌ ERROR: No coordinates found in file!');
  console.log('   This could mean:');
  console.log('   • File is corrupted or empty');
  console.log('   • File uses unsupported coordinate format');
  console.log('   • XML parsing failed');
  process.exit(1);
}

// Show coordinate bounds
const lats = coords.map(c => c.lat);
const lons = coords.map(c => c.lon);
console.log(`📍 COORDINATE ANALYSIS:`);
console.log(`   • Latitude range: ${Math.min(...lats).toFixed(6)} to ${Math.max(...lats).toFixed(6)}`);
console.log(`   • Longitude range: ${Math.min(...lons).toFixed(6)} to ${Math.max(...lons).toFixed(6)}`);

// TMNP boundary for reference
const allBoundaryPoints = [];
tmnpPolygons.forEach(polygon => {
  allBoundaryPoints.push(...polygon.outer);
});
const tmnpLats = allBoundaryPoints.map(p => p[1]);
const tmnpLons = allBoundaryPoints.map(p => p[0]);
console.log(`\n🗺️ TMNP BOUNDARY (for comparison):`);
console.log(`   • Latitude range: ${Math.min(...tmnpLats).toFixed(6)} to ${Math.max(...tmnpLats).toFixed(6)}`);
console.log(`   • Longitude range: ${Math.min(...tmnpLons).toFixed(6)} to ${Math.max(...tmnpLons).toFixed(6)}\n`);

// Test all coordinates for violations
let violationCount = 0;
let violatingCoords = [];

console.log('🧪 VIOLATION DETECTION TEST:');
for (let i = 0; i < coords.length; i++) {
  const coord = coords[i];
  const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
  if (isViolation) {
    violationCount++;
    violatingCoords.push({...coord, index: i});
  }
}

console.log(`   • Total coordinates tested: ${coords.length}`);
console.log(`   • Violations found: ${violationCount}`);
console.log(`   • Violation rate: ${((violationCount/coords.length)*100).toFixed(2)}%\n`);

if (violationCount === 0) {
  console.log('❌ REJECTION REASON: NO TMNP VIOLATIONS DETECTED');
  console.log('\n🔍 DETAILED ANALYSIS:');
  
  // Show why coordinates don't violate
  console.log('   Testing sample coordinates against TMNP boundary:');
  const sampleIndices = [0, Math.floor(coords.length/4), Math.floor(coords.length/2), Math.floor(coords.length*3/4), coords.length-1];
  
  for (const i of sampleIndices) {
    if (i < coords.length) {
      const coord = coords[i];
      const tmnpMinLat = Math.min(...tmnpLats);
      const tmnpMaxLat = Math.max(...tmnpLats);
      const tmnpMinLon = Math.min(...tmnpLons);
      const tmnpMaxLon = Math.max(...tmnpLons);
      
      let reason = '';
      if (coord.lat > tmnpMaxLat) reason = 'TOO FAR NORTH';
      else if (coord.lat < tmnpMinLat) reason = 'TOO FAR SOUTH';
      else if (coord.lon < tmnpMinLon) reason = 'TOO FAR WEST';
      else if (coord.lon > tmnpMaxLon) reason = 'TOO FAR EAST';
      else reason = 'OUTSIDE POLYGON BOUNDARIES';
      
      console.log(`     ${i+1}: lat=${coord.lat.toFixed(6)}, lon=${coord.lon.toFixed(6)} -> ${reason}`);
    }
  }
  
  console.log('\n💡 CONCLUSION:');
  console.log('   This flight does NOT enter TMNP restricted airspace.');
  console.log('   The system correctly rejected it to prevent false violations.');
  
} else {
  console.log('✅ VIOLATIONS DETECTED - This file SHOULD have been accepted!');
  console.log('\n🚁 VIOLATION DETAILS:');
  
  // Show first few violations
  for (let i = 0; i < Math.min(5, violatingCoords.length); i++) {
    const violation = violatingCoords[i];
    console.log(`   ${i+1}: Point ${violation.index + 1} - lat=${violation.lat.toFixed(6)}, lon=${violation.lon.toFixed(6)}`);
  }
  
  if (violatingCoords.length > 5) {
    console.log(`   ... and ${violatingCoords.length - 5} more violations`);
  }
  
  console.log('\n❗ SYSTEM ERROR: File should have been ACCEPTED but was rejected!');
  console.log('   This indicates a potential bug in the upload system.');
}
