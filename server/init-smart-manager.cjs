const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

// Initialize the smart manager with existing files
function initializeWithExistingFiles() {
  const uploadsDir = path.join(__dirname, 'uploads');
  const processedFile = path.join(__dirname, 'processed-files.json');
  
  console.log('🚀 Initializing Smart KML Manager with existing files...');
  
  const allFiles = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  console.log(`📁 Found ${allFiles.length} existing KML files`);
  
  const processed = { files: {}, lastScan: null };
  
  for (const filename of allFiles) {
    try {
      const filePath = path.join(uploadsDir, filename);
      
      // Generate content hash for the file
      const content = fs.readFileSync(filePath, 'utf8');
      const normalizedContent = content
        .replace(/<when>[^<]*<\/when>/g, '') // Remove timestamp elements
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      const contentHash = crypto.createHash('md5').update(normalizedContent).digest('hex');
      
      // Parse some basic metadata
      const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
      const xml = parser.parse(content);
      
      let registration = '';
      let date = '';
      
      // Quick extraction of registration and date
      const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
      const kmlRoot = doc || xml.kml;
      
      // Try to extract registration from filename (since files are already organized)
      const regMatch = filename.match(/\d{4}-\d{2}-\d{2}-([A-Z0-9-]+)-/);
      if (regMatch) {
        registration = regMatch[1];
      }
      
      // Extract date from filename
      const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-/);
      if (dateMatch) {
        date = dateMatch[1];
      }
      
      // Mark as processed
      processed.files[filename] = {
        originalName: filename,
        processedAt: new Date().toISOString(),
        contentHash: contentHash,
        metadata: { registration, date, time: '00:00' }
      };
      
      if ((Object.keys(processed.files).length % 50) === 0) {
        console.log(`  ✅ Processed ${Object.keys(processed.files).length}/${allFiles.length} files...`);
      }
      
    } catch (error) {
      console.log(`❌ Error processing ${filename}: ${error.message}`);
    }
  }
  
  // Save processed files list
  processed.lastScan = new Date().toISOString();
  fs.writeFileSync(processedFile, JSON.stringify(processed, null, 2));
  
  console.log(`✅ Successfully initialized Smart KML Manager with ${Object.keys(processed.files).length} files`);
  console.log(`📝 Saved to: ${processedFile}`);
}

// Run if called directly
if (require.main === module) {
  initializeWithExistingFiles();
}

module.exports = { initializeWithExistingFiles }; 