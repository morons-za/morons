const fs = require('fs');
const path = require('path');

function renameKmlFiles() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  
  // Load the existing metadata cache
  if (!fs.existsSync(cacheFile)) {
    console.log('❌ No metadata cache found. Run rescan-kmls.cjs first.');
    return;
  }
  
  const metadata = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  console.log(`📋 Loaded metadata for ${metadata.length} flights`);
  
  let renamed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const flight of metadata) {
    try {
      const oldPath = path.join(uploadsDir, flight.filename);
      
      // Skip if file doesn't exist
      if (!fs.existsSync(oldPath)) {
        console.log(`⚠️ File not found: ${flight.filename}`);
        skipped++;
        continue;
      }
      
      // Extract original unique ID from filename
      const originalId = flight.filename.replace('.kml', '');
      
      // Create new filename: YYYY-MM-DD-REGISTRATION-ORIGINALID.kml
      let newFilename;
      if (flight.date && flight.date !== '-' && flight.registration && flight.registration !== '-') {
        // Clean registration (remove any special characters)
        const cleanReg = flight.registration.replace(/[^A-Z0-9-]/g, '');
        newFilename = `${flight.date}-${cleanReg}-${originalId}.kml`;
      } else {
        // If missing date or registration, use a fallback format
        const cleanReg = flight.registration && flight.registration !== '-' ? flight.registration.replace(/[^A-Z0-9-]/g, '') : 'UNKNOWN';
        const dateStr = flight.date && flight.date !== '-' ? flight.date : 'UNKNOWN-DATE';
        newFilename = `${dateStr}-${cleanReg}-${originalId}.kml`;
      }
      
      const newPath = path.join(uploadsDir, newFilename);
      
      // Skip if already has the right name
      if (flight.filename === newFilename) {
        console.log(`✅ Already named correctly: ${newFilename}`);
        skipped++;
        continue;
      }
      
      // Check if target filename already exists
      if (fs.existsSync(newPath)) {
        console.log(`⚠️ Target filename already exists: ${newFilename}`);
        skipped++;
        continue;
      }
      
      // Rename the file
      fs.renameSync(oldPath, newPath);
      console.log(`📝 Renamed: ${flight.filename} → ${newFilename}`);
      
      // Update the metadata entry
      flight.filename = newFilename;
      renamed++;
      
    } catch (error) {
      console.log(`❌ Error renaming ${flight.filename}: ${error.message}`);
      errors++;
    }
  }
  
  // Save updated metadata cache
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(metadata, null, 2));
    console.log(`💾 Updated metadata cache with new filenames`);
  } catch (error) {
    console.log(`❌ Error saving metadata cache: ${error.message}`);
  }
  
  console.log(`\\n📊 Rename Summary:`);
  console.log(`  ✅ Renamed: ${renamed} files`);
  console.log(`  ⏭️ Skipped: ${skipped} files`);
  console.log(`  ❌ Errors: ${errors} files`);
  console.log(`  📁 Total processed: ${metadata.length} files`);
  
  if (renamed > 0) {
    console.log(`\\n🔄 Recommendation: Restart the server to reload with new filenames`);
  }
}

// Show preview first
function showPreview() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
  
  if (!fs.existsSync(cacheFile)) {
    console.log('❌ No metadata cache found. Run rescan-kmls.cjs first.');
    return;
  }
  
  const metadata = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  console.log(`\\n🔍 Preview of filename changes (first 10):`);
  
  for (let i = 0; i < Math.min(10, metadata.length); i++) {
    const flight = metadata[i];
    const originalId = flight.filename.replace('.kml', '');
    
    let newFilename;
    if (flight.date && flight.date !== '-' && flight.registration && flight.registration !== '-') {
      const cleanReg = flight.registration.replace(/[^A-Z0-9-]/g, '');
      newFilename = `${flight.date}-${cleanReg}-${originalId}.kml`;
    } else {
      const cleanReg = flight.registration && flight.registration !== '-' ? flight.registration.replace(/[^A-Z0-9-]/g, '') : 'UNKNOWN';
      const dateStr = flight.date && flight.date !== '-' ? flight.date : 'UNKNOWN-DATE';
      newFilename = `${dateStr}-${cleanReg}-${originalId}.kml`;
    }
    
    if (flight.filename !== newFilename) {
      console.log(`  ${flight.filename} → ${newFilename}`);
    } else {
      console.log(`  ${flight.filename} (no change needed)`);
    }
  }
  
  if (metadata.length > 10) {
    console.log(`  ... and ${metadata.length - 10} more files`);
  }
}

// Check command line argument
const command = process.argv[2];

if (command === 'preview') {
  showPreview();
} else if (command === 'rename') {
  console.log('🚀 Starting KML file rename operation...');
  renameKmlFiles();
} else {
  console.log(`
📁 KML File Renamer

Usage:
  node rename-kmls.cjs preview  - Show preview of changes
  node rename-kmls.cjs rename   - Actually rename the files

This will rename KML files from format:
  393559d5.kml
To format:
  2025-02-21-ZT-REG-393559d5.kml

The original unique ID is preserved for traceability.
  `);
} 