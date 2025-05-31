const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

function extractKmlInfoFromFile(filePath, filename) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    let registration = '';
    let date = '';
    let time = '';
    let imageUrl = '';
    let owner = '';
    
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    const kmlRoot = doc || xml.kml;
    
    const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
    const isAdsb = filename.includes('track') || (!doc && xml.kml.Folder);
    
    console.log(`[KML SOURCE] ${filename}: ${isFlightRadar24 ? 'FlightRadar24' : isAdsb ? 'ADS-B Exchange' : 'Unknown'}`);
    
    if (isAdsb) {
      console.log('Processing ADS-B Exchange format...');
      
      if (kmlRoot && kmlRoot.Folder) {
        console.log('Found kmlRoot.Folder');
        
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          console.log('Found nested Folder.Folder structure');
          if (Array.isArray(kmlRoot.Folder.Folder)) {
            foldersToSearch = kmlRoot.Folder.Folder;
          } else {
            foldersToSearch = [kmlRoot.Folder.Folder];
          }
        } else {
          console.log('Using numeric key structure');
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        console.log(`Searching ${foldersToSearch.length} folders`);
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            console.log(`Found ${placemarks.length} placemarks`);
            
            for (const pm of placemarks) {
              if (pm.name) {
                console.log(`Checking placemark name: ${pm.name}`);
                const regMatch = pm.name.match(/^([A-Z0-9]{2}-[A-Z0-9]{2,3})$/);
                if (regMatch) {
                  registration = regMatch[1];
                  console.log(`[KML REGEX] Matched registration: ${registration}`);
                  break;
                }
              }
            }
            if (registration) break;
          }
        }
        
        // Now look for timestamps
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            
            for (const pm of placemarks) {
              if (pm['gx:Track'] && pm['gx:Track'].when) {
                console.log('Found gx:Track with when elements');
                const whenElements = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
                console.log(`When elements count: ${whenElements.length}`);
                
                if (whenElements.length > 0) {
                  const firstWhen = whenElements[0];
                  console.log(`First when: ${firstWhen}`);
                  const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
                  if (whenMatch) {
                    date = whenMatch[1];
                    time = whenMatch[2];
                    console.log(`[KML REGEX] Matched date/time: ${date} ${time}`);
                    break;
                  }
                }
              }
            }
            if (date && time) break;
          }
        }
      }
    }
    
    console.log(`[FINAL] registration=${registration}, date=${date}, time=${time}`);
    return { filename, registration, date, time, imageUrl, owner };
  } catch (e) {
    console.log(`[ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '', imageUrl: '', owner: '' };
  }
}

// Test the specific file
const filename = 'ZS-HMB-track-EGM96.kml';
const filePath = path.join(__dirname, 'uploads', filename);
const result = extractKmlInfoFromFile(filePath, filename);
console.log('\\nFinal result:', result); 