const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Load TMNP boundary coordinates from KML file
function loadTMNPCoordinates() {
  try {
    const kmlPath = path.join(__dirname, '..', '..', '..', 'static-site', 'tmnp.kml');
    console.log('Loading TMNP boundary from:', kmlPath);
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
        
        console.log(`Processing ${coordLines.length} coordinate points in outer boundary`);
        
        for (const line of coordLines) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            // KML coordinates are in lon,lat format
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              outer.push([lon, lat]); // Store as lon,lat for pointInPolygon function
            }
          }
        }
        
        // Show some sample coordinates from the boundary
        console.log('Sample boundary coordinates:');
        for (let i = 0; i < Math.min(5, outer.length); i++) {
          console.log(`  [${i}] lon=${outer[i][0]}, lat=${outer[i][1]}`);
        }
      }
      
      if (outer.length > 0) {
        polygons.push({ outer, inner });
      }
    }
    
    const doc = xml.kml.Document;
    if (doc.Placemark) {
      const placemarks = Array.isArray(doc.Placemark) ? doc.Placemark : [doc.Placemark];
      console.log(`Found ${placemarks.length} placemarks in TMNP KML`);
      
      for (const placemark of placemarks) {
        if (placemark.Polygon) {
          console.log(`Processing polygon for placemark: ${placemark.name || 'unnamed'}`);
          processPolygon(placemark.Polygon);
        } else if (placemark.MultiGeometry && placemark.MultiGeometry.Polygon) {
          const polygonList = Array.isArray(placemark.MultiGeometry.Polygon) 
            ? placemark.MultiGeometry.Polygon 
            : [placemark.MultiGeometry.Polygon];
          
          console.log(`Processing MultiGeometry with ${polygonList.length} polygons`);
          for (const polygon of polygonList) {
            processPolygon(polygon);
          }
        }
      }
    }
    
    console.log(`✅ Loaded ${polygons.length} TMNP polygon(s)`);
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
    const xi = poly[i][0], yi = poly[i][1]; // lon, lat
    const xj = poly[j][0], yj = poly[j][1]; // lon, lat
    
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

// Debug test
console.log('🔍 TMNP Boundary Validation Debug');
console.log('==================================\n');

const tmnpPolygons = loadTMNPCoordinates();

if (tmnpPolygons.length === 0) {
  console.log('❌ No TMNP polygons loaded - exiting');
  process.exit(1);
}

console.log('\n📍 Testing helicopter coordinates from failed files:');

// Test coordinates from the rejected KML files
const testCoords = [
  { name: 'ZS-HIE Point 1', lat: -33.889935, lon: 18.433399 },
  { name: 'ZS-HIE Point 2', lat: -33.887516, lon: 18.434372 },
  { name: 'ZS-HIE Point 3', lat: -33.886444, lon: 18.434658 },
  { name: 'ZS-HIE Point 4', lat: -33.8857, lon: 18.434772 },
  { name: 'ZS-HIE Point 5', lat: -33.884815, lon: 18.434772 }
];

console.log('\n🚁 Testing rejected helicopter coordinates:');
testCoords.forEach((coord, i) => {
  const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
  console.log(`${coord.name}: lat=${coord.lat}, lon=${coord.lon} -> ${isViolation ? '✅ VIOLATION' : '❌ NO VIOLATION'}`);
});

// Test with some known Cape Town landmarks that should be violations
const landmarks = [
  { name: 'Table Mountain Summit', lat: -33.9628, lon: 18.4098 },
  { name: 'V&A Waterfront', lat: -33.9022, lon: 18.4184 },
  { name: 'Cape Point', lat: -34.3570, lon: 18.4970 },
  { name: 'Clifton Beach', lat: -33.9374, lon: 18.3765 }
];

console.log('\n🏔️ Testing known Cape Town landmarks:');
landmarks.forEach((landmark) => {
  const isViolation = pointInTMNP(landmark.lat, landmark.lon, tmnpPolygons);
  console.log(`${landmark.name}: lat=${landmark.lat}, lon=${landmark.lon} -> ${isViolation ? '✅ VIOLATION' : '❌ NO VIOLATION'}`);
});

// Show polygon bounds to understand the coverage area
if (tmnpPolygons.length > 0) {
  console.log('\n📐 TMNP Polygon Bounds Analysis:');
  tmnpPolygons.forEach((polygon, i) => {
    const coords = polygon.outer;
    if (coords.length > 0) {
      const lons = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      
      console.log(`Polygon ${i}: ${coords.length} points`);
      console.log(`  Longitude range: ${minLon.toFixed(6)} to ${maxLon.toFixed(6)}`);
      console.log(`  Latitude range: ${minLat.toFixed(6)} to ${maxLat.toFixed(6)}`);
    }
  });
}