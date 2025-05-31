const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const xmlData = fs.readFileSync('uploads/39963b15.kml', 'utf8');
const parser = new XMLParser({ 
  ignoreAttributes: false, 
  parseAttributeValue: false, 
  parseTagValue: false 
});

const doc = parser.parse(xmlData);
const kmlDoc = doc.kml?.Document || doc.Document || doc.kml || doc;

console.log('Document structure:');
console.log('Has Folder:', !!kmlDoc.Folder);

if (kmlDoc.Folder) {
  console.log('Folder structure:', Object.keys(kmlDoc.Folder));
  
  // Check if Folder is parsed as array-like with numeric keys
  if (kmlDoc.Folder['0']) {
    console.log('Folder appears to be array-like, checking each folder:');
    const folderKeys = Object.keys(kmlDoc.Folder).filter(key => !isNaN(key));
    
    for (const key of folderKeys) {
      const folder = kmlDoc.Folder[key];
      console.log(`\nFolder[${key}]:`);
      console.log('  Keys:', Object.keys(folder));
      console.log('  Name:', folder.name);
      
      if (folder.Placemark) {
        const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
        console.log(`  Placemarks: ${placemarks.length}`);
        if (placemarks.length > 0) {
          console.log(`  First placemark name: "${placemarks[0].name}"`);
        }
      }
    }
  }
}

console.log('\nDocument top-level keys:', Object.keys(kmlDoc));

console.log('\nDirect Placemark check:');
if (kmlDoc.Placemark) {
  const placemarks = Array.isArray(kmlDoc.Placemark) ? kmlDoc.Placemark : [kmlDoc.Placemark];
  console.log('Direct placemarks count:', placemarks.length);
} 