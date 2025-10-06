const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// Paths
const uploadsDir = path.join(__dirname, '..', 'uploads');
const masterMetadataFile = path.join(__dirname, '..', 'server', 'master-metadata.json');
const helicoptersFile = path.join(__dirname, '..', 'server', 'helicopters.json');

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

// Extract info from KML filename and content
function extractKmlInfo(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-([A-Z0-9-]+)-[A-Za-z0-9]+\.kml$/);
  if (!match) return null;
  
  const [_, date, registration] = match;
  let time = '00:00'; // Default fallback
  
  // Try to extract time from KML content
  try {
    const filePath = path.join(uploadsDir, filename);
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    
    // Look for time in multiple places
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    
    // First try: Look for TimeStamp in Placemark (check both Document and Folder)
    let placemarks = [];
    if (doc && doc.Placemark) {
      placemarks = Array.isArray(doc.Placemark) ? doc.Placemark : [doc.Placemark];
    } else if (doc && doc.Folder) {
      const folders = Array.isArray(doc.Folder) ? doc.Folder : [doc.Folder];
      for (const folder of folders) {
        if (folder.Placemark) {
          const folderPlacemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
          placemarks.push(...folderPlacemarks);
        }
      }
    }
    
    for (const placemark of placemarks) {
      if (placemark.TimeStamp && placemark.TimeStamp.when) {
        // Extract time from ISO format: "2025-08-24T11:08:52+00:00"
        const timeMatch = placemark.TimeStamp.when.match(/T(\d{2}:\d{2}):\d{2}/);
        if (timeMatch) {
          time = timeMatch[1];
          break;
        }
      }
    }
    
    // Second try: Look for ATD (Actual Time of Departure) in description
    if (time === '00:00' && doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      
      // Extract ATD time (e.g., "11:08" from "ATD 11:08 UTC")
      const atdMatch = desc.match(/ATD[^>]*?(\d{1,2}:\d{2})/i);
      if (atdMatch) {
        time = atdMatch[1];
      }
    }
  } catch (e) {
    console.warn(`Warning: Could not extract time from ${filename}: ${e.message}`);
  }
  
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
        contact: heliData.contact || '',
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