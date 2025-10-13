const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Copy the duplicate detection functions from server
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
    
    // Handle case where KML doesn't have Document wrapper (ADS-B Exchange)
    const kmlRoot = doc || xml.kml;
    
    // Determine KML source and extract accordingly
    const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
    const isAdsb = filename.includes('track') || (!doc && xml.kml.Folder);
    
    console.log(`[KML SOURCE] ${filename}: ${isFlightRadar24 ? 'FlightRadar24' : isAdsb ? 'ADS-B Exchange' : 'Unknown'}`);
    
    if (isFlightRadar24) {
      // FlightRadar24 format parsing
      if (doc.name) {
        // Handle formats like "-/ZSHMB" or "FlightRadar24/ZSHMB"
        const regMatch = doc.name.match(/[A-Z]{2}[A-Z0-9]{3}$/);
        if (regMatch) {
          const rawReg = regMatch[0]; // e.g., "ZSHMB"
          // Convert to proper format: ZSHMB -> ZS-HMB
          registration = rawReg.slice(0, 2) + '-' + rawReg.slice(2);
          console.log(`[KML REGEX] Matched registration in name: ${registration}`);
        }
      }
    }
    
    // Extract date/time from first placemark
    const firstPlacemark = findFirstPlacemark(kmlRoot);
    if (firstPlacemark && firstPlacemark.TimeStamp && firstPlacemark.TimeStamp.when) {
      const timestamp = firstPlacemark.TimeStamp.when;
      const dateMatch = timestamp.match(/(\\d{4}-\\d{2}-\\d{2})/);
      const timeMatch = timestamp.match(/T(\\d{2}:\\d{2})/);
      
      if (dateMatch) {
        date = dateMatch[1];
        console.log(`[KML TIMESTAMP] Date extracted: ${date}`);
      }
      if (timeMatch) {
        time = timeMatch[1];
        console.log(`[KML TIMESTAMP] Time extracted: ${time}`);
      }
    }
    
    // Return processed metadata
    return {
      filename: path.basename(filePath),
      registration,
      date,
      time,
      imageUrl,
      owner
    };
  } catch (error) {
    console.error(`❌ Error parsing ${filename}:`, error.message);
    return {
      filename,
      registration: 'ERROR',
      date: 'ERROR',
      time: 'ERROR',
      imageUrl: '',
      owner: ''
    };
  }
}

// Load existing metadata (simulate server state)
let kmlMetadata = [];
async function loadMetadata() {
  try {
    const masterFile = path.join(__dirname, '..', '..', '..', 'server', 'master-metadata.json');
    if (fs.existsSync(masterFile)) {
      const masterData = JSON.parse(fs.readFileSync(masterFile, 'utf8'));
      if (masterData && masterData.flights) {
        kmlMetadata = masterData.flights;
        console.log(`📋 Loaded ${kmlMetadata.length} existing flights from metadata`);
        return;
      }
    }
    console.log('⚠️ No existing metadata found');
  } catch (error) {
    console.log(`❌ Error loading metadata: ${error.message}`);
  }
}

// Duplicate detection function (exact copy)
function isDuplicateFlight(kmlInfo, filePath) {
  try {
    // Check 1: Flight signature (registration + date + time) - FAST
    const flightSignature = `${kmlInfo.registration}-${kmlInfo.date}-${kmlInfo.time}`;
    
    // Check if we already have a flight with this signature
    const existingFlight = kmlMetadata.find(flight => 
      flight.registration === kmlInfo.registration &&
      flight.date === kmlInfo.date &&
      flight.time === kmlInfo.time
    );
    
    if (existingFlight) {
      console.log(`🔄 Duplicate flight detected: ${flightSignature} (already exists as ${existingFlight.filename})`);
      return {
        isDuplicate: true,
        reason: 'FLIGHT_SIGNATURE_MATCH',
        existingFile: existingFlight.filename,
        details: `Flight ${kmlInfo.registration} on ${kmlInfo.date} at ${kmlInfo.time} already exists`
      };
    }
    
    // Check 2: Content hash - simplified version
    try {
      const fileContent = fs.readFileSync(filePath);
      const contentHash = require('crypto').createHash('md5').update(fileContent).digest('hex');
      console.log(`📊 File content hash: ${contentHash.substring(0, 12)}...`);
      
      // Would need to check against existing hashes, but skipping for this test
    } catch (hashError) {
      console.log(`⚠️ Could not check content hash: ${hashError.message}`);
    }
    
    return { isDuplicate: false };
    
  } catch (error) {
    console.log(`⚠️ Error checking for duplicates: ${error.message}`);
    return { isDuplicate: false };
  }
}

// Test the specific file
async function testFile() {
  console.log('🔍 TESTING DUPLICATE DETECTION');
  console.log('════════════════════════════════\\n');

  const targetFile = '/Users/werner/Downloads/KMLs to be uploaded/3be1939b.kml';
  
  // Load existing metadata
  await loadMetadata();
  
  // Extract info from target file
  console.log(`📄 Analyzing file: ${path.basename(targetFile)}`);
  const meta = extractKmlInfoFromFile(targetFile, path.basename(targetFile));
  
  console.log(`\\n📋 EXTRACTED METADATA:`);
  console.log(`   Registration: ${meta.registration}`);
  console.log(`   Date: ${meta.date}`);
  console.log(`   Time: ${meta.time}`);
  console.log(`   Flight signature: ${meta.registration}-${meta.date}-${meta.time}`);
  
  // Check for duplicates
  console.log(`\\n🔍 DUPLICATE DETECTION TEST:`);
  const duplicateResult = isDuplicateFlight(meta, targetFile);
  
  console.log(`\\n🏁 RESULT:`);
  if (duplicateResult.isDuplicate) {
    console.log(`❌ FILE FLAGGED AS DUPLICATE!`);
    console.log(`   Reason: ${duplicateResult.reason}`);
    console.log(`   Details: ${duplicateResult.details}`);
    console.log(`   Existing file: ${duplicateResult.existingFile}`);
    console.log(`\\n💡 This explains why the file was rejected - it never reached violation detection!`);
  } else {
    console.log(`✅ Not a duplicate - should proceed to violation detection`);
    console.log(`\\n❓ This means the issue is elsewhere in the upload pipeline`);
  }
}

testFile().catch(console.error);
