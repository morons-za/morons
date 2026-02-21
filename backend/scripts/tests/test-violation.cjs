const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Test both files
const UPLOADS = path.join(__dirname, '..', '..', 'uploads');
const rejectedFile = path.join(UPLOADS, '3bfd81ed.kml');
const acceptedFile = path.join(UPLOADS, '2025-03-26-ZS-HBO-399fed56.kml');

console.log('🔍 Testing violation detection...\n');

function extractCoordinates(filePath) {
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

console.log('📝 Rejected file:', rejectedFile);
const rejectedCoords = extractCoordinates(rejectedFile);
console.log(`   ${rejectedCoords.length} coordinates found`);
console.log(`   Sample coordinates: lat=${rejectedCoords[0].lat}, lon=${rejectedCoords[0].lon}`);
console.log(`                      lat=${rejectedCoords[100].lat}, lon=${rejectedCoords[100].lon}`);

console.log('\n✅ Accepted file:', acceptedFile);
const acceptedCoords = extractCoordinates(acceptedFile);
console.log(`   ${acceptedCoords.length} coordinates found`);
console.log(`   Sample coordinates: lat=${acceptedCoords[0].lat}, lon=${acceptedCoords[0].lon}`);
if (acceptedCoords.length > 100) {
  console.log(`                      lat=${acceptedCoords[100].lat}, lon=${acceptedCoords[100].lon}`);
}

// Compare coordinate ranges
const rejectedLats = rejectedCoords.map(c => c.lat);
const rejectedLons = rejectedCoords.map(c => c.lon);
const acceptedLats = acceptedCoords.map(c => c.lat);
const acceptedLons = acceptedCoords.map(c => c.lon);

console.log('\n📊 Coordinate Ranges:');
console.log(`❌ Rejected: lat ${Math.min(...rejectedLats).toFixed(6)} to ${Math.max(...rejectedLats).toFixed(6)}`);
console.log(`           lon ${Math.min(...rejectedLons).toFixed(6)} to ${Math.max(...rejectedLons).toFixed(6)}`);
console.log(`✅ Accepted: lat ${Math.min(...acceptedLats).toFixed(6)} to ${Math.max(...acceptedLats).toFixed(6)}`);
console.log(`           lon ${Math.min(...acceptedLons).toFixed(6)} to ${Math.max(...acceptedLons).toFixed(6)}`);
