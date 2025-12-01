#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  const specialPattern = /^\d{4}-\d{2}-\d{2}-(UNKNOWN|ZS-[A-Z0-9]{3}-[A-Z0-9]+)\.kml$/;
  return pattern.test(filename) || specialPattern.test(filename);
}

// Function to extract registration from KML content
function extractRegistrationFromKML(kmlPath) {
  try {
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);

    // Recursively search for Placemark name
    function findPlacemarkName(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.name && typeof obj.name === 'string') {
        // ADS-B Exchange format: "ZS-HMB track" or "ZT-RPG track"
        const trackMatch = obj.name.match(/^([A-Z]{2}-[A-Z0-9]{3})\s+track$/i);
        if (trackMatch) {
          return trackMatch[1];
        }
        // 6-char hex or alphanum registration
        const regMatch = obj.name.match(/^([A-Z0-9]{6})$/);
        if (regMatch) {
          const rawReg = regMatch[1];
          return rawReg.slice(0, 2) + '-' + rawReg.slice(2);
        }
        // ZS-XXX format
        const zsMatch = obj.name.match(/^ZS-[A-Z0-9]{3}$/);
        if (zsMatch) {
          return zsMatch[0];
        }
      }
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const result = findPlacemarkName(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }

    // Try recursive search
    const reg = findPlacemarkName(xml);
    if (reg) return reg;

    // Fallback: previous logic
    if (xml.kml && xml.kml.Folder && xml.kml.Folder.Folder) {
      const folder = xml.kml.Folder.Folder;
      if (folder.name && folder.name.includes('track')) {
        const regMatch = folder.name.match(/([A-Z0-9]{2}-[A-Z0-9]{3})/);
        if (regMatch) {
          return regMatch[1];
        }
      }
    }
    if (xml.kml && xml.kml.Document) {
      const doc = xml.kml.Document;
      if (doc.name) {
        const regMatch = doc.name.match(/[A-Z]{2}[A-Z0-9]{3}$/);
        if (regMatch) {
          const rawReg = regMatch[0];
          return rawReg.slice(0, 2) + '-' + rawReg.slice(2);
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Error extracting registration from KML:', error.message);
    return null;
  }
}

// Function to extract metadata from KML
function extractKMLMetadata(kmlPath) {
  try {
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    let registration = '';
    let date = '';
    
    // Recursively search for registration in Placemark name
    function findPlacemarkName(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.name && typeof obj.name === 'string') {
        // ADS-B Exchange format: "ZS-HMB track" or "ZT-RPG track"
        const trackMatch = obj.name.match(/^([A-Z]{2}-[A-Z0-9]{3})\s+track$/i);
        if (trackMatch) {
          return trackMatch[1];
        }
        // 6-char hex or alphanum registration
        const regMatch = obj.name.match(/^([A-Z0-9]{6})$/);
        if (regMatch) {
          const rawReg = regMatch[1];
          return rawReg.slice(0, 2) + '-' + rawReg.slice(2);
        }
        // ZS-XXX format
        const zsMatch = obj.name.match(/^ZS-[A-Z0-9]{3}$/);
        if (zsMatch) {
          return zsMatch[0];
        }
      }
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const result = findPlacemarkName(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }

    // Recursively search for the first <when> element
    function findWhen(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.when && typeof obj.when === 'string') {
        return obj.when;
      }
      if (Array.isArray(obj.when) && obj.when.length > 0) {
        return obj.when[0];
      }
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          const result = findWhen(obj[key]);
          if (result) return result;
        }
      }
      return null;
    }

    registration = findPlacemarkName(xml);
    const whenString = findWhen(xml);
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
    let metadata = extractKMLMetadata(filePath);
    
    // If metadata extraction failed, try to extract registration directly
    if (!metadata || !metadata.registration) {
      const registration = extractRegistrationFromKML(filePath);
      if (registration) {
        metadata = { ...metadata, registration };
      }
    }
    
    if (!metadata || !metadata.registration || !metadata.date) {
      console.log(`❌ Could not extract metadata from ${filename}, skipping`);
      continue;
    }
    
    // Extract hash from current filename or generate one
    const hashMatch = filename.match(/([a-f0-9]{8})\.kml$/);
    let hash;
    
    if (hashMatch) {
      // Use existing valid hash
      hash = hashMatch[1];
    } else {
      // Generate new 8-character hash from file content
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const fullHash = crypto.createHash('md5').update(fileContent).digest('hex');
      hash = fullHash.substring(0, 8);
      console.log(`📝 Generated hash: ${hash}`);
    }
    
    // Generate new filename
    const newFilename = `${metadata.date}-${metadata.registration}-${hash}.kml`;
    const newFilePath = path.join(uploadsDir, newFilename);
    
    console.log(`📝 ${metadata.registration} on ${metadata.date} -> ${newFilename}`);
    
    // Check if target file already exists (duplicate detection)
    if (fs.existsSync(newFilePath)) {
      console.log(`⚠️  Duplicate detected: ${newFilename} already exists`);
      console.log(`🗑️  Removing duplicate upload: ${filename}`);
      fs.unlinkSync(filePath);
      continue;
    }
    
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

// Function to update master metadata incrementally
async function updateMasterMetadataIncremental(newFiles) {
  if (newFiles.length === 0) return;
  
  const { generateMasterMetadata } = require('./generate-master-metadata.cjs');
  
  console.log(`📝 Adding ${newFiles.length} new flights to master metadata...`);
  
  // Regenerate master metadata (it's smart enough to be fast)
  await generateMasterMetadata();
  
  console.log('✅ Master metadata updated with new flights');
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
      
      // Step 3: Update master metadata incrementally for new files only
      console.log('🔄 Updating master metadata with new flights...');
      await updateMasterMetadataIncremental(renamedFiles);
      
    } else {
      console.log('\n✅ No new files to process.');
    }
    
    // Step 4: Always clear cache to ensure server picks up any new files
    clearCache();
    console.log('🔄 Cache cleared - server will refresh metadata on next request');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main(); 