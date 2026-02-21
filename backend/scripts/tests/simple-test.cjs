const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const testFile = path.join(__dirname, '..', '..', 'uploads', '3bfd81ed.kml');
console.log('🔍 Parsing KML structure...');

const xmlData = fs.readFileSync(testFile, 'utf8');
const parser = new XMLParser({ ignoreAttributes: false });
const xml = parser.parse(xmlData);

const coordinates = [];

function extractCoords(obj, path = '') {
  if (!obj || typeof obj !== 'object') return;

  // Check for Point coordinates
  if (obj.Point && obj.Point.coordinates) {
    const coordStr = obj.Point.coordinates;
    console.log(`📍 Point found: "${coordStr}"`);
    const parts = coordStr.split(',');
    if (parts.length >= 2) {
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        coordinates.push({ lat, lon });
        console.log(`   ✅ Added: lat=${lat}, lon=${lon}`);
      }
    }
  }

  // Recursively search other objects
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      extractCoords(obj[key], `${path}/${key}`);
    }
  }
}

extractCoords(xml);
console.log(`\n📊 Total coordinates extracted: ${coordinates.length}`);

if (coordinates.length > 0) {
  const lats = coordinates.map(c => c.lat);
  const lons = coordinates.map(c => c.lon);
  console.log(`   First 3 coordinates:`);
  coordinates.slice(0, 3).forEach((c, i) => {
    console.log(`     ${i+1}: lat=${c.lat}, lon=${c.lon}`);
  });
  console.log(`   Latitude range: ${Math.min(...lats)} to ${Math.max(...lats)}`);
  console.log(`   Longitude range: ${Math.min(...lons)} to ${Math.max(...lons)}`);
}
