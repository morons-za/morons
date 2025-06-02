const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Load helicopter metadata
function loadHelicopterMetadata() {
  try {
    const helicoptersPath = path.join(__dirname, 'helicopters.json');
    if (fs.existsSync(helicoptersPath)) {
      const data = fs.readFileSync(helicoptersPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading helicopter metadata:', error);
  }
  return {};
}

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
    
    // Determine KML source and extract accordingly
    const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
    const isAdsb = filename.includes('track') || (!doc && xml.kml.Folder);
    
    console.log(`[KML SOURCE] ${filename}: ${isFlightRadar24 ? 'FlightRadar24' : isAdsb ? 'ADS-B Exchange' : 'Unknown'}`);
    
    if (!isAdsb) {
      // FlightRadar24 format parsing
      // First try to extract from description (as a link) - this preserves the correct format
      if (doc && doc.description) {
        let desc = doc.description;
        desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
        // Look for registration link pattern like: <a href="https://www.flightradar24.com/reg/zs-hmb">ZS-HMB</a>
        let regMatch = desc.match(/<a[^>]*href="[^"]*\/reg\/([a-z0-9-]+)"[^>]*>([A-Z0-9-]+)<\/a>/i);
        if (regMatch) {
          registration = regMatch[2]; // Use the display text (ZS-HMB) not the URL part (zs-hmb)
          console.log(`[KML REGEX] Matched registration in description link: ${registration}`);
        }
      }
      
      // Fallback: try name if description didn't work
      if (!registration && doc.name) {
        // Match last 5 uppercase letters/numbers and convert to proper format
        const regMatch = doc.name.match(/[A-Z0-9]{5}$/);
        if (regMatch) {
          const match = regMatch[0];
          // Convert ZSHMB format to ZS-HMB format
          registration = match.slice(0, 2) + '-' + match.slice(2);
          console.log(`[KML REGEX] Matched registration in name: ${registration}`);
        }
      }
    } else if (isAdsb) {
      // ADS-B Exchange format parsing
      if (kmlRoot && kmlRoot.Folder) {
        // Handle nested Folder structure (ADS-B Exchange has Folder.Folder)
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          // Nested folder structure (xml.kml.Folder.Folder)
          if (Array.isArray(kmlRoot.Folder.Folder)) {
            foldersToSearch = kmlRoot.Folder.Folder;
          } else {
            foldersToSearch = [kmlRoot.Folder.Folder];
          }
        } else {
          // Direct folder structure with numeric keys
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              if (pm.name) {
                // Look for registration pattern like "ZS-HMB"
                const regMatch = pm.name.match(/^([A-Z0-9]{2}-[A-Z0-9]{2,3})$/);
                if (regMatch) {
                  registration = regMatch[1];
                  console.log(`[KML REGEX] Matched registration in Placemark name: ${registration}`);
                  break;
                }
              }
            }
            if (registration) break;
          }
        }
      }
      
      // Fallback: try filename if not found in content
      if (!registration) {
        const fileRegMatch = filename.match(/^([A-Z0-9]{2}-[A-Z0-9]{3})/);
        if (fileRegMatch) {
          registration = fileRegMatch[1];
          console.log(`[KML REGEX] Matched registration in filename: ${registration}`);
        }
      }
    }
    
    // Date/Time extraction (same for both formats)
    let placemark = null;
    if (doc) {
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
      placemark = findFirstPlacemark(doc);
    }
    if (placemark && placemark.name) {
      const dtMatch = placemark.name.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      if (dtMatch) {
        date = dtMatch[1];
        time = dtMatch[2];
        console.log(`[KML REGEX] Matched date/time in Placemark name: ${date} ${time}`);
      }
    }
    
    // Try to find TimeStamp when elements (common in ADS-B Exchange)
    if ((!date || !time) && kmlRoot && kmlRoot.Folder) {
      // Handle nested Folder structure (ADS-B Exchange has Folder.Folder)
      let foldersToSearch = [];
      
      if (kmlRoot.Folder.Folder) {
        // Nested folder structure (xml.kml.Folder.Folder)
        if (Array.isArray(kmlRoot.Folder.Folder)) {
          foldersToSearch = kmlRoot.Folder.Folder;
        } else {
          foldersToSearch = [kmlRoot.Folder.Folder];
        }
      } else {
        // Direct folder structure with numeric keys
        const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
        foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
      }
      
      for (const folder of foldersToSearch) {
        if (folder.Placemark) {
          const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
          for (const pm of placemarks) {
            // Check for gx:Track when elements (ADS-B Exchange format)
            if (pm['gx:Track'] && pm['gx:Track'].when) {
              const whenElements = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
              if (whenElements.length > 0) {
                const firstWhen = whenElements[0];
                const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
                if (whenMatch) {
                  date = whenMatch[1];
                  time = whenMatch[2];
                  console.log(`[KML REGEX] Matched date/time in gx:Track when: ${date} ${time}`);
                  break;
                }
              }
            }
          }
          if (date && time) break;
        }
      }
    }
    
    // Fallback: try <span title="YYYY-MM-DD HH:MM"> in description
    if ((!date || !time) && doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      let dtMatch = desc.match(/<span[^>]+title=\"(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\">/);
      if (dtMatch) {
        date = dtMatch[1];
        time = dtMatch[2];
        console.log(`[KML REGEX] Matched date/time in description: ${date} ${time}`);
      }
    }
    
    // Debug log for each file
    console.log(`[KML DEBUG] ${filename}: registration=${registration}, date=${date}, time=${time}, imageUrl=${imageUrl}, owner=${owner}`);
    return { filename, registration, date, time, imageUrl, owner };
  } catch (e) {
    console.log(`[KML ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '', imageUrl: '', owner: '' };
  }
}

function scanKmlMetadata() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  
  console.log(`Found ${files.length} KML files to process...`);
  
  const kmlMetadata = files.map((filename, idx) => {
    console.log(`Processing ${idx + 1}/${files.length}: ${filename}`);
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfoFromFile(filePath, filename);
    
    // Only return basic flight data - helicopter metadata comes from helicopters.json
    return {
      filename: meta.filename,
      registration: meta.registration,
      date: meta.date,
      time: meta.time
    };
  }).filter(meta => meta.registration && meta.registration !== '-'); // Only include flights with valid registration
  
  console.log(`✅ Successfully processed ${kmlMetadata.length} KML files with valid registrations`);
  
  // Load helicopter metadata and merge
  const helicopterData = loadHelicopterMetadata();
  console.log(`✅ Loaded metadata for ${Object.keys(helicopterData).length} helicopters`);
  
  const enrichedMetadata = kmlMetadata.map(flight => ({
    ...flight,
    owner: helicopterData[flight.registration]?.owner || '',
    imageUrl: helicopterData[flight.registration]?.imageUrl || ''
  }));
  
  // Write to a temp file so the server can read it (optional)
  const outputPath = path.join(__dirname, 'kml-metadata-cache.json');
  fs.writeFileSync(outputPath, JSON.stringify(enrichedMetadata, null, 2));
  console.log(`✅ Cached metadata to ${outputPath}`);
  
  return enrichedMetadata;
}

// Run the scan
console.log('🔄 Starting KML metadata scan...');
const result = scanKmlMetadata();
console.log(`✅ Scan complete! Found ${result.length} flights.`);

// Show a sample of the results
if (result.length > 0) {
  console.log('\n📋 Sample results:');
  result.slice(0, 5).forEach(flight => {
    console.log(`  ${flight.filename} - ${flight.registration} - ${flight.date} ${flight.time} - ${flight.owner || 'No owner'}`);
  });
  if (result.length > 5) {
    console.log(`  ... and ${result.length - 5} more flights`);
  }
} 