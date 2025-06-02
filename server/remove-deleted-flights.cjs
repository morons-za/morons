const fs = require('fs');
const path = require('path');

// List of deleted flight files (without .kml extension)
const deletedFlights = [
  '2025-02-21-ZT-REG-3934e54e',
  '2025-03-10-ZT-REG-396becb8',
  '2025-03-12-ZS-HIE-3971ec0b',
  '2025-04-29-ZS-HIE-3a1b88d5',
  '2025-05-03-ZS-HIM-3a2afe6f',
  '2025-05-19-ZS-RTG-3a672d59'
];

function cleanMetadataCache() {
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  
  if (!fs.existsSync(cacheFile)) {
    console.log('❌ Metadata cache file not found');
    return;
  }
  
  try {
    // Read current cache
    const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const originalCount = Object.keys(cacheData).length;
    
    console.log(`📊 Original cache contained ${originalCount} flights`);
    
    // Remove deleted flights
    let removedCount = 0;
    for (const flightKey of deletedFlights) {
      const kmlFilename = `${flightKey}.kml`;
      console.log(`🔍 Looking for: ${kmlFilename}`);
      
      if (cacheData[kmlFilename]) {
        delete cacheData[kmlFilename];
        removedCount++;
        console.log(`🗑️  Removed ${kmlFilename} from cache`);
      } else {
        console.log(`❌ Not found in cache: ${kmlFilename}`);
        // Let's check if it exists with a different key
        const foundKeys = Object.keys(cacheData).filter(key => key.includes(flightKey));
        if (foundKeys.length > 0) {
          console.log(`🔍 Found similar keys: ${foundKeys.join(', ')}`);
        }
      }
    }
    
    const finalCount = Object.keys(cacheData).length;
    
    // Write updated cache
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
    
    console.log(`✅ Cache cleanup complete!`);
    console.log(`📊 Removed ${removedCount} flights`);
    console.log(`📊 Cache now contains ${finalCount} flights`);
    console.log(`📊 Expected count: ${originalCount - 6} (original - deleted)`);
    
    if (finalCount === originalCount - 6) {
      console.log('🎯 Cache count matches expected result!');
    } else {
      console.log('⚠️  Cache count doesn\'t match expected result');
    }
    
  } catch (error) {
    console.error('❌ Error cleaning metadata cache:', error.message);
  }
}

// Run the cleanup
cleanMetadataCache(); 