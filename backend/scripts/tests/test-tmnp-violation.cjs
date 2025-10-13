const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Load TMNP boundary coordinates from KML file
function loadTMNPCoordinates() {
  try {
    const kmlPath = path.join(__dirname, '..', '..', '..', 'static-site', 'tmnp.kml');
    console.log('📍 Loading TMNP boundary from:', kmlPath);
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

// Test violation detection
console.log('🔍 Testing TMNP violation detection...\n');

// Load TMNP boundary
const tmnpPolygons = loadTMNPCoordinates();
console.log(`🗺️ Loaded ${tmnpPolygons.length} TMNP polygon(s)`);

if (tmnpPolygons.length > 0) {
  const firstPolygon = tmnpPolygons[0];
  console.log(`   First polygon has ${firstPolygon.outer.length} outer boundary points`);
  console.log(`   First polygon has ${firstPolygon.inner.length} inner boundary (holes)`);
  
  // Show sample boundary points
  console.log(`   Sample boundary points:`);
  console.log(`     ${firstPolygon.outer[0]} (first)`);
  console.log(`     ${firstPolygon.outer[Math.floor(firstPolygon.outer.length/2)]} (middle)`);
  console.log(`     ${firstPolygon.outer[firstPolygon.outer.length-1]} (last)`);
  
  // Test some coordinates from both files
  console.log('\n🧪 Testing coordinates:');
  
  // From rejected file
  const rejectedCoords = [
    { lat: -33.889935, lon: 18.433399 },  // First coordinate from rejected file
    { lat: -33.951096, lon: 18.344702 },  // 100th coordinate from rejected file
    { lat: -34.000000, lon: 18.400000 }   // Rough center of Table Mountain area
  ];
  
  // From accepted file  
  const acceptedCoords = [
    { lat: -33.888538, lon: 18.434715 },  // First coordinate from accepted file
    { lat: -33.967484, lon: 18.474352 }   // 100th coordinate from accepted file
  ];
  
  console.log('❌ Testing rejected file coordinates:');
  rejectedCoords.forEach((coord, i) => {
    const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    console.log(`   ${i+1}: lat=${coord.lat}, lon=${coord.lon} -> ${isViolation ? '🚁 VIOLATION' : '✅ No violation'}`);
  });
  
  console.log('\n✅ Testing accepted file coordinates:');
  acceptedCoords.forEach((coord, i) => {
    const isViolation = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    console.log(`   ${i+1}: lat=${coord.lat}, lon=${coord.lon} -> ${isViolation ? '🚁 VIOLATION' : '✅ No violation'}`);
  });
  
} else {
  console.log('❌ No TMNP polygons loaded!');
}
