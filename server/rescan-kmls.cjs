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
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name, jpath, isLeafNode, isAttribute) => false
  });
  
  const doc = parser.parse(xmlData);
  let kmlDoc = doc.kml?.Document || doc.Document || doc.kml || doc;
  
  // Look for registration in the document name
  let registration = '';
  if (kmlDoc?.name && typeof kmlDoc.name === 'string') {
    console.log(`[DEBUG] Document name: "${kmlDoc.name}"`);
    
    // Check for patterns like "-/ZTREG" or "ZT-HBO" in the name
    let regMatch = kmlDoc.name.match(/([A-Z]{2}-[A-Z0-9]{3})/);
    if (!regMatch) {
      // Try pattern like "-/ZTREG" and convert to "ZT-REG"
      const altMatch = kmlDoc.name.match(/-\/ZT([A-Z0-9]{3})/);
      if (altMatch) {
        registration = `ZT-${altMatch[1]}`;
      } else {
        // Try pattern like "-/ZSHBO" and convert to "ZT-HBO" 
        const altMatch2 = kmlDoc.name.match(/-\/ZS([A-Z0-9]{3})/);
        if (altMatch2) {
          registration = `ZT-${altMatch2[1]}`;
        }
      }
    } else {
      registration = regMatch[1];
    }
  }
  
  // Try to find Placemark data for date/time - check folders
  let date = '', time = '';
  let placemarksToCheck = [];
  
  if (kmlDoc?.Folder) {
    // Handle case where Folder is parsed as array-like with numeric keys
    if (kmlDoc.Folder['0']) {
      const folderKeys = Object.keys(kmlDoc.Folder).filter(key => !isNaN(key));
      for (const key of folderKeys) {
        const folder = kmlDoc.Folder[key];
        if (folder.Placemark) {
          const folderPlacemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
          placemarksToCheck.push(...folderPlacemarks);
        }
      }
    } else if (kmlDoc.Folder.Placemark) {
      // Handle single folder case
      placemarksToCheck = Array.isArray(kmlDoc.Folder.Placemark) ? kmlDoc.Folder.Placemark : [kmlDoc.Folder.Placemark];
    }
  } else if (kmlDoc?.Placemark) {
    // Handle direct placemarks
    placemarksToCheck = Array.isArray(kmlDoc.Placemark) ? kmlDoc.Placemark : [kmlDoc.Placemark];
  }
  
  // Look for earliest timestamp in placemarks
  for (const placemark of placemarksToCheck) {
    if (placemark?.name && typeof placemark.name === 'string') {
      // Look for patterns like "2025-03-23 10:03:13 UTC"
      const dateTimeMatch = placemark.name.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
      if (dateTimeMatch) {
        date = dateTimeMatch[1];
        time = dateTimeMatch[2];
        console.log(`[DEBUG] Found date/time: ${date} ${time}`);
        break; // Take the first timestamp found
      }
    }
  }
  
  const result = {
    filename,
    registration: registration || '-',
    date: date || '-',
    time: time || '-'
  };
  
  console.log(`[DEBUG] Final result for ${filename}:`, result);
  return result;
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