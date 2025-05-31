const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Debug specific ADS-B Exchange file
const filename = 'ZS-HMB-track-EGM96.kml';
const filePath = path.join(__dirname, 'uploads', filename);

if (!fs.existsSync(filePath)) {
  console.log(`❌ File not found: ${filePath}`);
  process.exit(1);
}

const xmlData = fs.readFileSync(filePath, 'utf8');
const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
const xml = parser.parse(xmlData);

console.log('=== KML STRUCTURE DEBUG ===');
console.log('XML root keys:', Object.keys(xml));

if (xml.kml) {
  console.log('\\nKML keys:', Object.keys(xml.kml));
  
  if (xml.kml.Document) {
    console.log('\\nDocument found');
    const doc = xml.kml.Document;
    console.log('Document keys:', Object.keys(doc));
  } else {
    console.log('\\nNo Document wrapper - direct KML structure');
    console.log('KML direct contents:', Object.keys(xml.kml));
    
    if (xml.kml.Folder) {
      console.log('\\nFound Folder in KML root');
      if (Array.isArray(xml.kml.Folder)) {
        console.log('Folder is array, length:', xml.kml.Folder.length);
        xml.kml.Folder.forEach((folder, idx) => {
          console.log(`\\nFolder ${idx}:`);
          console.log('  Name:', folder.name || 'NO NAME');
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            console.log(`  Placemarks: ${placemarks.length}`);
            placemarks.slice(0, 2).forEach((pm, pmIdx) => {
              console.log(`    Placemark ${pmIdx + 1}:`);
              console.log(`      name: ${pm.name || 'NO NAME'}`);
              if (pm['gx:Track']) {
                console.log(`      has gx:Track`);
                if (pm['gx:Track'].when) {
                  const whens = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
                  console.log(`      when elements: ${whens.length}, first: ${whens[0]}`);
                }
              }
            });
          }
        });
      } else {
        console.log('Folder is object, keys:', Object.keys(xml.kml.Folder));
        
        // Check if there's a nested Folder
        if (xml.kml.Folder.Folder) {
          console.log('\\nFound nested Folder.Folder');
          const nestedFolder = xml.kml.Folder.Folder;
          console.log('Nested folder keys:', Object.keys(nestedFolder));
          console.log('Nested folder name:', nestedFolder.name || 'NO NAME');
          
          if (nestedFolder.Placemark) {
            const placemarks = Array.isArray(nestedFolder.Placemark) ? nestedFolder.Placemark : [nestedFolder.Placemark];
            console.log(`\\nFound ${placemarks.length} placemarks in nested folder`);
            
            placemarks.slice(0, 2).forEach((pm, idx) => {
              console.log(`\\nPlacemark ${idx + 1}:`);
              console.log('  name:', pm.name || 'NO NAME');
              console.log('  keys:', Object.keys(pm));
              if (pm['gx:Track']) {
                console.log('  has gx:Track, keys:', Object.keys(pm['gx:Track']));
                if (pm['gx:Track'].when) {
                  const whens = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
                  console.log(`  when elements: ${whens.length}`);
                  console.log(`  first when: ${whens[0]}`);
                  console.log(`  last when: ${whens[whens.length - 1]}`);
                }
              }
            });
          }
        }
      }
    }
  }
} 