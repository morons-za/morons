#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { generateMasterMetadata } = require('./generate-master-metadata.cjs');

console.log('🚁 Processing new KML files...');

// Check if we're in the right directory structure
const serverDir = path.join(__dirname, 'server');
const uploadsDir = path.join(serverDir, 'uploads');
const flightMapsDir = path.join(serverDir, 'flight-maps');

if (!fs.existsSync(uploadsDir)) {
  console.error('❌ Error: uploads directory not found. Make sure you run this from the project root.');
  process.exit(1);
}

// Function to check if a filename matches the expected format
function isProperlyNamed(filename) {
  // Should match: YYYY-MM-DD-REGISTRATION-HASH.kml
  const pattern = /^\d{4}-\d{2}-\d{2}-[A-Z]{2}-[A-Z0-9]{3}-[a-f0-9]{8}\.kml$/;
  return pattern.test(filename);
}

// Function to extract metadata from KML
function extractKMLMetadata(kmlPath) {
  try {
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    let registration = '';
    let date = '';
    let time = '';
    
    // Extract registration from name (FlightRadar24 format: -/ZSRTG -> ZS-RTG)
    function findNameElement(obj) {
      if (!obj || typeof obj !== 'object') return null;
      
      if (obj.name && typeof obj.name === 'string') {
        const nameMatch = obj.name.match(/-\/([A-Z]{2})([A-Z0-9]{3})/);
        if (nameMatch) {
          return `${nameMatch[1]}-${nameMatch[2]}`;
        }
        
        // Alternative format
        const altMatch = obj.name.match(/([A-Z]{2}-[A-Z0-9]{3})/);
        if (altMatch) {
          return altMatch[1];
        }
      }
      
      // Recursively search
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const result = findNameElement(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }
    
    // Extract date from when elements
    function findWhenElement(obj) {
      if (!obj || typeof obj !== 'object') return null;
      
      if (obj.when && typeof obj.when === 'string') {
        return obj.when;
      }
      
      // Recursively search
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const result = findWhenElement(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }
    
    registration = findNameElement(xml);
    const whenString = findWhenElement(xml);
    
    if (whenString) {
      // Parse: 2025-06-01T07:53:48+00:00
      const dateMatch = whenString.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
      }
    }
    
    return { registration, date };
  } catch (error) {
    console.error('Error parsing KML:', error.message);
    return null;
  }
}

// Main processing function
async function processNewKMLs() {
  // Find all KML files
  const allFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.kml'));
  const improperlyNamed = allFiles.filter(f => !isProperlyNamed(f));
  
  if (improperlyNamed.length === 0) {
    console.log('✅ All KML files are properly named!');
    return [];
  }
  
  console.log(`📁 Found ${improperlyNamed.length} files that need renaming:`);
  improperlyNamed.forEach(f => console.log(`  - ${f}`));
  
  const renamedFiles = [];
  
  // Process each improperly named file
  for (const filename of improperlyNamed) {
    console.log(`\n🔍 Processing ${filename}...`);
    
    const filePath = path.join(uploadsDir, filename);
    const metadata = extractKMLMetadata(filePath);
    
    if (!metadata || !metadata.registration || !metadata.date) {
      console.log(`❌ Could not extract metadata from ${filename}, skipping`);
      continue;
    }
    
    // Extract hash from current filename (should be the part before .kml)
    const hashMatch = filename.match(/([a-f0-9]{8})\.kml$/);
    const hash = hashMatch ? hashMatch[1] : filename.replace('.kml', '');
    
    // Generate new filename
    const newFilename = `${metadata.date}-${metadata.registration}-${hash}.kml`;
    const newFilePath = path.join(uploadsDir, newFilename);
    
    console.log(`📝 ${metadata.registration} on ${metadata.date} -> ${newFilename}`);
    
    // Rename the file
    try {
      fs.renameSync(filePath, newFilePath);
      console.log(`✅ Renamed to ${newFilename}`);
      renamedFiles.push(newFilename);
    } catch (error) {
      console.error(`❌ Error renaming ${filename}:`, error.message);
    }
  }
  
  return renamedFiles;
}

// Function to generate PNG files
async function generatePNGs(files) {
  if (files.length === 0) return;
  
  console.log(`\n🖼️  Generating PNG files for ${files.length} flights...`);
  
  // Read the existing flight image generator
  const generatorPath = path.join(serverDir, 'generate-flight-image.cjs');
  if (!fs.existsSync(generatorPath)) {
    console.error('❌ Flight image generator not found');
    return;
  }
  
  // Create a modified script for our specific files
  const originalScript = fs.readFileSync(generatorPath, 'utf8');
  const modifiedScript = originalScript.replace(
    'const kmlFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith(\'.kml\'));',
    `const kmlFiles = ${JSON.stringify(files)};`
  ).replace(
    'processAllFiles().catch(console.error);',
    `
async function processSpecificFiles() {
  console.log('Generating PNG files for new KML files...');
  
  const uploadsDir = path.join(__dirname, 'uploads');
  const outputDir = path.join(__dirname, 'flight-maps');
  
  const kmlFiles = ${JSON.stringify(files)};
  console.log(\`📁 Processing \${kmlFiles.length} KML files\`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of kmlFiles) {
    try {
      const pngFilename = filename.replace('.kml', '.png');
      const pngPath = path.join(outputDir, pngFilename);
      
      if (fs.existsSync(pngPath)) {
        skipped++;
        console.log(\`⏭️  Skipping \${pngFilename} (already exists)\`);
        continue;
      }
      
      processed++;
      console.log(\`[\${processed}/\${kmlFiles.length}] Generating \${pngFilename}...\`);
      
      await generateFlightImage(filename);
      console.log(\`✅ Generated \${pngFilename}\`);
    } catch (error) {
      errors++;
      console.error(\`❌ Error processing \${filename}:\`, error.message);
    }
  }

  console.log(\`🎉 PNG generation complete! \${processed} generated, \${skipped} skipped, \${errors} errors\`);
}

processSpecificFiles().catch(console.error);
    `
  );
  
  // Write and execute the temporary script
  const tempScript = path.join(serverDir, 'temp-png-generator.cjs');
  fs.writeFileSync(tempScript, modifiedScript);
  
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const { stdout, stderr } = await execAsync(`node temp-png-generator.cjs`, { cwd: serverDir });
    console.log(stdout);
    if (stderr) console.error('Stderr:', stderr);
  } finally {
    // Clean up
    if (fs.existsSync(tempScript)) {
      fs.unlinkSync(tempScript);
    }
  }
}

// Function to clear cache
function clearCache() {
  const cacheFile = path.join(serverDir, 'kml-metadata-cache.json');
  if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
    console.log('🗑️  Cleared metadata cache');
  } else {
    console.log('ℹ️  No metadata cache found to clear');
  }
}

// Main execution
async function main() {
  try {
    // Step 1: Rename files
    const renamedFiles = await processNewKMLs();
    
    // Step 2: Generate PNGs
    if (renamedFiles.length > 0) {
      await generatePNGs(renamedFiles);
      console.log('\n🎉 All done! New files processed successfully.');
      console.log(`📊 Final summary: ${renamedFiles.length} files renamed and PNG files generated`);
    } else {
      console.log('\n✅ No new files to process.');
    }
    
    // Step 3: Always clear cache to ensure server picks up any new files
    clearCache();
    console.log('🔄 Cache cleared - server will refresh metadata on next request');
    
    // Step 4: Regenerate master metadata file for fast server startup
    console.log('\n🔄 Regenerating master metadata file...');
    await generateMasterMetadata();
    console.log('✅ Master metadata updated - server will start quickly!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main(); 