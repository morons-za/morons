#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 Starting comprehensive cleanup of duplicate files...\n');

// Files to delete
const filesToDelete = [
  '3ca715dd.kml',
  '3ca7a27a.kml', 
  '3ca001b0.kml',
  '3c79d71a.kml',
  '3c75ba34.kml'
];

const uploadsDir = path.join(__dirname, '..', 'uploads');
const optimizedDir = path.join(__dirname, '..', '..', 'static-site', 'kml-optimised');
const flightMapsDir = path.join(__dirname, '..', 'flight-maps');
const metadataFile = path.join(__dirname, 'master-metadata.json');
const processedFile = path.join(__dirname, 'processed-files.json');

let deletedCount = 0;
let errors = [];

console.log('📋 Files to delete:');
filesToDelete.forEach(file => console.log(`   • ${file}`));
console.log('');

// 1. Delete KML files from uploads directory
console.log('🗑️ Step 1: Deleting KML files from uploads directory...');
filesToDelete.forEach(filename => {
  const filePath = path.join(uploadsDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`   ✅ Deleted: ${filename}`);
      deletedCount++;
    } else {
      console.log(`   ⚠️ Not found: ${filename}`);
    }
  } catch (error) {
    console.log(`   ❌ Error deleting ${filename}: ${error.message}`);
    errors.push(`KML ${filename}: ${error.message}`);
  }
});

// 2. Delete optimized KML files
console.log('\n🗑️ Step 2: Deleting optimized KML files...');
filesToDelete.forEach(filename => {
  const optimizedPath = path.join(optimizedDir, filename);
  try {
    if (fs.existsSync(optimizedPath)) {
      fs.unlinkSync(optimizedPath);
      console.log(`   ✅ Deleted optimized: ${filename}`);
    } else {
      console.log(`   ⚠️ Optimized not found: ${filename}`);
    }
  } catch (error) {
    console.log(`   ❌ Error deleting optimized ${filename}: ${error.message}`);
    errors.push(`Optimized ${filename}: ${error.message}`);
  }
});

// 3. Delete PNG files
console.log('\n🗑️ Step 3: Deleting PNG files...');
filesToDelete.forEach(filename => {
  const pngFilename = filename.replace('.kml', '.png');
  const pngPath = path.join(flightMapsDir, pngFilename);
  try {
    if (fs.existsSync(pngPath)) {
      fs.unlinkSync(pngPath);
      console.log(`   ✅ Deleted PNG: ${pngFilename}`);
    } else {
      console.log(`   ⚠️ PNG not found: ${pngFilename}`);
    }
  } catch (error) {
    console.log(`   ❌ Error deleting PNG ${pngFilename}: ${error.message}`);
    errors.push(`PNG ${pngFilename}: ${error.message}`);
  }
});

// 4. Update master metadata
console.log('\n📝 Step 4: Updating master metadata...');
try {
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  const originalCount = metadata.flights.length;
  
  // Remove flights with deleted filenames
  metadata.flights = metadata.flights.filter(flight => 
    !filesToDelete.includes(flight.filename)
  );
  
  const removedCount = originalCount - metadata.flights.length;
  metadata.totalFiles = metadata.flights.length;
  metadata.validFlights = metadata.flights.length;
  metadata.generated = new Date().toISOString();
  
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  console.log(`   ✅ Updated master metadata: removed ${removedCount} flights`);
  console.log(`   📊 New total: ${metadata.flights.length} flights`);
} catch (error) {
  console.log(`   ❌ Error updating master metadata: ${error.message}`);
  errors.push(`Master metadata: ${error.message}`);
}

// 5. Update processed files
console.log('\n📝 Step 5: Updating processed files...');
try {
  const processed = JSON.parse(fs.readFileSync(processedFile, 'utf8'));
  const originalProcessedCount = Object.keys(processed.files).length;
  
  // Remove entries for deleted files
  filesToDelete.forEach(filename => {
    if (processed.files[filename]) {
      delete processed.files[filename];
    }
  });
  
  const removedProcessedCount = originalProcessedCount - Object.keys(processed.files).length;
  processed.lastScan = new Date().toISOString();
  
  fs.writeFileSync(processedFile, JSON.stringify(processed, null, 2));
  console.log(`   ✅ Updated processed files: removed ${removedProcessedCount} entries`);
} catch (error) {
  console.log(`   ❌ Error updating processed files: ${error.message}`);
  errors.push(`Processed files: ${error.message}`);
}

// Summary
console.log('\n📊 Cleanup Summary:');
console.log(`   • KML files deleted: ${deletedCount}`);
console.log(`   • Files processed: ${filesToDelete.length}`);
console.log(`   • Errors encountered: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n❌ Errors:');
  errors.forEach(error => console.log(`   • ${error}`));
}

console.log('\n✅ Cleanup completed!');
console.log('🔄 Next steps:');
console.log('   1. Restart the backend server');
console.log('   2. Run "Refresh Metadata (Full)" in admin interface');
console.log('   3. Run "Build Static Site" to update the static site');
console.log('   4. Verify the static site shows correct flight count');