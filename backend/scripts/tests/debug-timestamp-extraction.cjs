const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const targetFile = '/Users/werner/Downloads/KMLs to be uploaded/3be1939b.kml';

console.log('🔍 DEBUGGING TIMESTAMP EXTRACTION\n');

const xmlData = fs.readFileSync(targetFile, 'utf8');
const parser = new XMLParser({ ignoreAttributes: false });
const xml = parser.parse(xmlData);

// Helper: recursively find first Placemark
function findFirstPlacemark(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.Placemark) {
    if (Array.isArray(obj.Placemark)) return obj.Placemark[0];
    return obj.Placemark;
  }
  for (const key of Object.keys(obj)) {
    const found = findFirstPlacemark(obj[key]);
    if (found) return found;
  }
  return null;
}

const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
const kmlRoot = doc || xml.kml;

console.log('📄 Document structure:');
console.log('   Has Document:', !!doc);
console.log('   Document name:', doc?.name);

const firstPlacemark = findFirstPlacemark(kmlRoot);
console.log('\n📍 First Placemark analysis:');
if (firstPlacemark) {
  console.log('   Has Placemark:', true);
  console.log('   Has TimeStamp:', !!firstPlacemark.TimeStamp);
  
  if (firstPlacemark.TimeStamp) {
    console.log('   TimeStamp.when:', firstPlacemark.TimeStamp.when);
    
    const timestamp = firstPlacemark.TimeStamp.when;
    console.log('\n🕒 Timestamp parsing:');
    console.log('   Raw timestamp:', timestamp);
    
    // Test the regex patterns used by server
    const dateMatch = timestamp.match(/(\\d{4}-\\d{2}-\\d{2})/);
    const timeMatch = timestamp.match(/T(\\d{2}:\\d{2})/);
    
    console.log('   Date regex result:', dateMatch);
    console.log('   Time regex result:', timeMatch);
    
    if (dateMatch) {
      console.log('   ✅ Date extracted:', dateMatch[1]);
    } else {
      console.log('   ❌ Date extraction FAILED');
    }
    
    if (timeMatch) {
      console.log('   ✅ Time extracted:', timeMatch[1]);
    } else {
      console.log('   ❌ Time extraction FAILED');
    }
    
  } else {
    console.log('   ❌ No TimeStamp found');
  }
} else {
  console.log('   ❌ No Placemark found');
}

// Look for other placemarks with timestamps
console.log('\n🔍 Looking for multiple placemarks...');
if (doc && doc.Placemark && Array.isArray(doc.Placemark)) {
  console.log(`   Found ${doc.Placemark.length} placemarks`);
  console.log('   First few timestamps:');
  for (let i = 0; i < Math.min(3, doc.Placemark.length); i++) {
    const pm = doc.Placemark[i];
    if (pm.TimeStamp && pm.TimeStamp.when) {
      console.log(`     ${i+1}: ${pm.TimeStamp.when}`);
    } else {
      console.log(`     ${i+1}: No timestamp`);
    }
  }
}
