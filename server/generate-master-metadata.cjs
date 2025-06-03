const fs = require('fs');
const path = require('path');

// Paths
const uploadsDir = path.join(__dirname, 'uploads');
const masterMetadataFile = path.join(__dirname, 'master-metadata.json');
const helicoptersFile = path.join(__dirname, 'helicopters.json');

// Load helicopter metadata
let helicopterMetadata = {};
try {
  if (fs.existsSync(helicoptersFile)) {
    helicopterMetadata = JSON.parse(fs.readFileSync(helicoptersFile, 'utf8'));
    console.log(`✅ Loaded metadata for ${Object.keys(helicopterMetadata).length} helicopters`);
  }
} catch (err) {
  console.error('❌ Error loading helicopter metadata:', err);
}

// Extract info from KML filename
function extractKmlInfo(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-([A-Z0-9-]+)-[a-f0-9]+\.kml$/);
  if (!match) return null;
  
  const [_, date, registration] = match;
  const time = '00:00'; // We'll get this from the file content later
  
  return {
    filename,
    registration,
    date,
    time
  };
}

// Main function
async function generateMasterMetadata() {
  console.log('🚀 Generating master metadata file...');
  
  // Get all KML files
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  console.log(`Found ${files.length} KML files`);
  
  const allFlights = [];
  
  // Process each file
  files.forEach((filename, idx) => {
    if (idx % 50 === 0) {
      console.log(`Processing file ${idx + 1}/${files.length}...`);
    }
    
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfo(filename);
    
    if (meta && meta.registration) {
      const heliData = helicopterMetadata[meta.registration] || {};
      
      // Calculate file size in MB
      const fileSizeBytes = fs.statSync(filePath).size;
      const fileSizeMB = parseFloat((fileSizeBytes / (1024 * 1024)).toFixed(2));
      
      allFlights.push({
        filename: meta.filename,
        registration: meta.registration,
        date: meta.date,
        time: meta.time,
        owner: heliData.owner || '',
        imageUrl: heliData.imageUrl || '',
        fileSizeMB
      });
    }
  });
  
  // Sort by date and time (newest first)
  allFlights.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.time.localeCompare(a.time);
  });
  
  // Generate metadata file
  const metadata = {
    generated: new Date().toISOString(),
    totalFiles: files.length,
    validFlights: allFlights.length,
    flights: allFlights
  };
  
  fs.writeFileSync(masterMetadataFile, JSON.stringify(metadata, null, 2));
  
  // Print summary
  console.log('');
  console.log('✅ Master metadata generated successfully!');
  console.log(`📊 Summary:`);
  console.log(`   • Total KML files: ${files.length}`);
  console.log(`   • Valid flights: ${allFlights.length}`);
  console.log(`   • Excluded files: ${files.length - allFlights.length}`);
  
  // Calculate total file size
  const totalSizeMB = allFlights.reduce((sum, flight) => sum + flight.fileSizeMB, 0);
  console.log(`   • Total flight data: ${totalSizeMB.toFixed(2)} MB`);
  console.log(`   • Average file size: ${(totalSizeMB / allFlights.length).toFixed(2)} MB`);
  console.log(`   • Metadata file size: ${Math.round(fs.statSync(masterMetadataFile).size / 1024)} KB`);
  console.log(`   • Output: ${path.relative(process.cwd(), masterMetadataFile)}`);
  console.log('');
  console.log('🚀 Server can now start quickly by reading this file!');
}

// Run the generator
generateMasterMetadata().catch(console.error); 