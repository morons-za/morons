const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Test coordinate extraction on the failing KML file
const testFile = path.join(__dirname, '..', '..', 'uploads', '3bfd81ed.kml');

console.log('🔍 Debugging coordinate extraction for:', testFile);

try {
  const xmlData = fs.readFileSync(testFile, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false });
  const xml = parser.parse(xmlData);

  console.log('📄 XML structure keys:', Object.keys(xml));
  
  const coordinates = [];
  let debugInfo = [];

  function extractCoords(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;

    // Check for gx:Track coordinates (ADS-B Exchange format)
    if (obj['gx:Track'] && obj['gx:Track'].coord) {
      debugInfo.push(`Found gx:Track at ${path}`);
      const coordElements = Array.isArray(obj['gx:Track'].coord) ? obj['gx:Track'].coord : [obj['gx:Track'].coord];
      console.log(`📍 gx:Track found with ${coordElements.length} coordinate elements`);
      for (const coord of coordElements.slice(0, 5)) { // Show first 5
        console.log(`   Raw coord: "${coord}"`);
        const parts = coord.split(' ');
        console.log(`   Split parts: [${parts.join(', ')}]`);
        if (parts.length >= 2) {
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            coordinates.push({ lat, lon });
            console.log(`   ✅ Added: lat=${lat}, lon=${lon}`);\n          } else {\n            console.log(`   ❌ Invalid numbers: lat=${lat}, lon=${lon}`);\n          }\n        } else {\n          console.log(`   ❌ Insufficient parts: ${parts.length}`);\n        }\n      }\n      if (coordElements.length > 5) {\n        console.log(`   ... and ${coordElements.length - 5} more coordinates`);\n      }\n    }\n\n    // Check for LineString coordinates (FlightRadar24 format)\n    if (obj.LineString && obj.LineString.coordinates) {\n      debugInfo.push(`Found LineString at ${path}`);\n      const coordStr = obj.LineString.coordinates;\n      console.log(`📍 LineString found`);\n      console.log(`   Raw coordinates string (first 200 chars): \"${coordStr.substring(0, 200)}...\"`);\n      \n      const coordLines = coordStr.trim().split(/\\s+/);\n      console.log(`   Split into ${coordLines.length} lines`);\n      \n      for (const line of coordLines.slice(0, 5)) { // Show first 5\n        console.log(`   Raw line: \"${line}\"`);\n        const parts = line.split(',');\n        console.log(`   Split parts: [${parts.join(', ')}]`);\n        if (parts.length >= 2) {\n          const lon = parseFloat(parts[0]);\n          const lat = parseFloat(parts[1]);\n          if (!isNaN(lat) && !isNaN(lon)) {\n            coordinates.push({ lat, lon });\n            console.log(`   ✅ Added: lat=${lat}, lon=${lon}`);\n          } else {\n            console.log(`   ❌ Invalid numbers: lat=${lat}, lon=${lon}`);\n          }\n        } else {\n          console.log(`   ❌ Insufficient parts: ${parts.length}`);\n        }\n      }\n      if (coordLines.length > 5) {\n        console.log(`   ... and ${coordLines.length - 5} more coordinate lines`);\n      }\n    }\n\n    // Check for Point coordinates\n    if (obj.Point && obj.Point.coordinates) {\n      debugInfo.push(`Found Point at ${path}`);\n      console.log(`📍 Point found: \"${obj.Point.coordinates}\"`);\n    }\n\n    // Recursively search other objects\n    for (const key in obj) {\n      if (typeof obj[key] === 'object') {\n        extractCoords(obj[key], `${path}/${key}`);\n      }\n    }\n  }\n\n  extractCoords(xml);\n\n  console.log(`\\n📊 Summary:`);\n  console.log(`   Found structures: ${debugInfo.join(', ')}`);\n  console.log(`   Total coordinates extracted: ${coordinates.length}`);\n  \n  if (coordinates.length > 0) {\n    console.log(`   First coordinate: lat=${coordinates[0].lat}, lon=${coordinates[0].lon}`);\n    console.log(`   Last coordinate: lat=${coordinates[coordinates.length-1].lat}, lon=${coordinates[coordinates.length-1].lon}`);\n    \n    // Show bounds\n    const lats = coordinates.map(c => c.lat);\n    const lons = coordinates.map(c => c.lon);\n    console.log(`   Latitude range: ${Math.min(...lats)} to ${Math.max(...lats)}`);\n    console.log(`   Longitude range: ${Math.min(...lons)} to ${Math.max(...lons)}`);\n  }\n\n} catch (error) {\n  console.error('❌ Error:', error.message);\n}\n"}