#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 Cleaning up duplicate and incomplete entries...');

// Load current metadata
const metadataPath = path.join(__dirname, 'master-metadata.json');
const cachePath = path.join(__dirname, 'kml-metadata-cache.json');

let metadata = [];
let cache = [];

// Load master metadata if it exists
if (fs.existsSync(metadataPath)) {
  try {
    const masterData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata = masterData.flights || [];
    console.log(`📋 Loaded ${metadata.length} flights from master metadata`);
  } catch (error) {
    console.error('❌ Error loading master metadata:', error.message);
  }
}

// Load cache if it exists
if (fs.existsSync(cachePath)) {
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`📋 Loaded ${cache.length} flights from cache`);
  } catch (error) {
    console.error('❌ Error loading cache:', error.message);
  }
}

// Function to remove duplicates based on filename
function removeDuplicates(flights) {
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  
  for (const flight of flights) {
    if (seen.has(flight.filename)) {
      duplicates.push(flight);
    } else {
      seen.add(flight.filename);
      unique.push(flight);
    }
  }
  
  return { unique, duplicates };
}

// Clean up master metadata
if (metadata.length > 0) {
  const { unique, duplicates } = removeDuplicates(metadata);
  console.log(`🗑️ Found ${duplicates.length} duplicate entries in master metadata`);
  
  if (duplicates.length > 0) {
    // Update master metadata
    const masterData = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    masterData.flights = unique;
    masterData.totalFlights = unique.length;
    masterData.validFlights = unique.length;
    
    fs.writeFileSync(metadataPath, JSON.stringify(masterData, null, 2));
    console.log(`✅ Updated master metadata: ${unique.length} flights`);
  }
}

// Clean up cache
if (cache.length > 0) {
  const { unique, duplicates } = removeDuplicates(cache);
  console.log(`🗑️ Found ${duplicates.length} duplicate entries in cache`);
  
  if (duplicates.length > 0) {
    fs.writeFileSync(cachePath, JSON.stringify(unique, null, 2));
    console.log(`✅ Updated cache: ${unique.length} flights`);
  }
}

// Check for incomplete entries (files without proper KML links)
console.log('\n🔍 Checking for incomplete entries...');
const uploadsDir = path.join(__dirname, 'uploads');
const flightMapsDir = path.join(__dirname, 'flight-maps');

if (fs.existsSync(uploadsDir)) {
  const kmlFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.kml'));
  console.log(`📁 Found ${kmlFiles.length} KML files in uploads directory`);
  
  // Check which files have corresponding PNG maps
  const pngFiles = fs.existsSync(flightMapsDir) 
    ? fs.readdirSync(flightMapsDir).filter(f => f.endsWith('.png'))
    : [];
  
  console.log(`🖼️ Found ${pngFiles.length} PNG files in flight-maps directory`);
  
  // Find files without PNG maps
  const incompleteFiles = kmlFiles.filter(kmlFile => {
    const pngFile = kmlFile.replace('.kml', '.png');
    return !pngFiles.includes(pngFile);
  });
  
  if (incompleteFiles.length > 0) {
    console.log(`⚠️ Found ${incompleteFiles.length} incomplete files (missing PNG maps):`);
    incompleteFiles.forEach(file => console.log(`   - ${file}`));
    
    console.log('\n💡 To fix incomplete files, run: node process-new-kmls.cjs');
  }
}

console.log('\n✅ Cleanup complete!');
console.log('🔄 Restart your server to see the cleaned metadata.'); 