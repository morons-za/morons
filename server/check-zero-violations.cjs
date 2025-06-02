const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

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

// Find violation points where flight path enters restricted airspace
function findViolationPoints(coordinates, tmnpPolygons) {
  const violations = [];
  let wasInside = false;
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    const isInside = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    
    // If we entered restricted airspace (outside -> inside)
    if (!wasInside && isInside) {
      violations.push({
        lat: coord.lat,
        lon: coord.lon,
        index: i
      });
    }
    
    wasInside = isInside;
  }
  
  return violations;
}

// Load TMNP coordinates (simplified version)
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
      const innerBoundaries = polygonObj.innerBoundaryIs || [];
      const innerArray = Array.isArray(innerBoundaries) ? innerBoundaries : [innerBoundaries];
      
      for (const innerBoundary of innerArray) {
        if (innerBoundary && innerBoundary.LinearRing) {
          const innerCoords = innerBoundary.LinearRing.coordinates;
          if (innerCoords) {
            const hole = [];
            const coordStr = typeof innerCoords === 'string' ? innerCoords : innerCoords.toString();
            const coordLines = coordStr.trim().split(/\s+/);
            
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
    
    // Find all polygons in the KML
    function findPolygons(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      if (obj.Polygon) {
        const polygonArray = Array.isArray(obj.Polygon) ? obj.Polygon : [obj.Polygon];
        for (const polygon of polygonArray) {
          processPolygon(polygon);
        }
      }
      
      if (obj.MultiGeometry && obj.MultiGeometry.Polygon) {
        const polygonArray = Array.isArray(obj.MultiGeometry.Polygon) ? obj.MultiGeometry.Polygon : [obj.MultiGeometry.Polygon];
        for (const polygon of polygonArray) {
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
    console.log('❌ Error loading TMNP coordinates:', error.message);
    return [];
  }
}

// Extract coordinates from KML
function extractCoordinates(xml) {
  const coordinates = [];
  
  // Try to find coordinates in various KML structures
  function findCoordinates(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Handle gx:coord elements (format: "longitude latitude altitude")
    if (obj['gx:coord']) {
      const coordElements = Array.isArray(obj['gx:coord']) ? obj['gx:coord'] : [obj['gx:coord']];
      
      for (const coordStr of coordElements) {
        if (typeof coordStr === 'string') {
          const parts = coordStr.trim().split(/\s+/);
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
    
    // Handle regular coordinates element (format: "longitude,latitude,altitude")
    if (obj.coordinates) {
      const coordStr = typeof obj.coordinates === 'string' ? obj.coordinates : obj.coordinates.toString();
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
    
    // Recursively search in all object properties
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        findCoordinates(obj[key]);
      }
    }
  }
  
  findCoordinates(xml);
  return coordinates;
}

// Main analysis function
async function analyzeFlights() {
  console.log('🔍 Analyzing all flights for zero violations...');
  
  const uploadsDir = path.join(__dirname, 'uploads');
  const kmlFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.kml'));
  
  console.log(`📁 Found ${kmlFiles.length} KML files to analyze`);
  
  // Load TMNP boundary once
  const tmnpCoords = loadTMNPCoordinates();
  console.log(`✅ Loaded ${tmnpCoords.length} TMNP polygons`);
  
  const parser = new XMLParser({ ignoreAttributes: false });
  
  const zeroViolationFlights = [];
  let processed = 0;
  
  for (const filename of kmlFiles) {
    try {
      const kmlPath = path.join(uploadsDir, filename);
      const xmlData = fs.readFileSync(kmlPath, 'utf8');
      const xml = parser.parse(xmlData);
      
      const coordinates = extractCoordinates(xml);
      
      if (coordinates.length === 0) {
        console.log(`⚠️ ${filename}: No coordinates found`);
        continue;
      }
      
      const violations = findViolationPoints(coordinates, tmnpCoords);
      
      if (violations.length === 0) {
        zeroViolationFlights.push({
          filename,
          points: coordinates.length
        });
        console.log(`✅ ${filename}: ${coordinates.length} points, 0 violations`);
      }
      
      processed++;
      if (processed % 50 === 0) {
        console.log(`📊 Processed ${processed}/${kmlFiles.length} files...`);
      }
      
    } catch (error) {
      console.log(`❌ Error processing ${filename}: ${error.message}`);
    }
  }
  
  console.log('\n📈 Analysis Complete!');
  console.log(`📊 Total flights analyzed: ${processed}`);
  console.log(`🚫 Flights with zero violations: ${zeroViolationFlights.length}`);
  
  if (zeroViolationFlights.length > 0) {
    console.log('\n📋 Flights with no TMNP violations:');
    zeroViolationFlights.forEach((flight, index) => {
      console.log(`${index + 1}. ${flight.filename} (${flight.points} points)`);
    });
  } else {
    console.log('\n🎯 All flights contain TMNP airspace violations!');
  }
}

// Run the analysis
analyzeFlights().catch(console.error); 