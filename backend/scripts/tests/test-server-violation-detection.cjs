const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Copy the EXACT server functions from index-no-auth.cjs
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
    // Both point and polygon are now in [lon, lat] format
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

// EXACT copy of server's checkForViolations function
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

// Test the exact server function on our problematic file
const targetFile = '/Users/werner/Downloads/KMLs to be uploaded/3be1939b.kml';

console.log('🔍 TESTING EXACT SERVER VIOLATION DETECTION FUNCTION');
console.log('═══════════════════════════════════════════════════════\n');

console.log(`📄 File: ${targetFile}`);
console.log('🧪 Running checkForViolations() exactly as server does...\n');

checkForViolations(targetFile).then(result => {
  console.log('\n🏁 SERVER FUNCTION RESULT:');
  console.log(`   checkForViolations() returned: ${result}`);
  console.log(`   File should be: ${result ? 'ACCEPTED ✅' : 'REJECTED ❌'}`);
  
  if (!result) {
    console.log('\n❗ DISCREPANCY CONFIRMED!');
    console.log('   • My analysis found 528 violations (4.56%)');
    console.log('   • Server function found 0 violations');
    console.log('   • This indicates the server code has a different bug');
  } else {
    console.log('\n✅ Server function working correctly');
    console.log('   • Bug may be elsewhere in upload pipeline');
  }
}).catch(error => {
  console.error('\n❌ Server function crashed:', error.message);
});
