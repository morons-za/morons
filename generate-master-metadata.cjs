#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

/**
 * Master Metadata Generator
 * 
 * This script generates a complete master metadata file containing all flight information.
 * The server reads this file on startup instead of scanning all KML files.
 * 
 * Usage:
 *   node generate-master-metadata.cjs
 * 
 * This should be run:
 * - After adding new KML files
 * - After running process-new-kmls.cjs
 * - Before deploying to production
 */

const uploadsDir = path.join(__dirname, 'server/uploads');
const helicoptersFile = path.join(__dirname, 'server/helicopters.json');
const masterMetadataFile = path.join(__dirname, 'server/master-metadata.json');

// Load helicopter metadata
function loadHelicopterMetadata() {
  if (fs.existsSync(helicoptersFile)) {
    const data = JSON.parse(fs.readFileSync(helicoptersFile, 'utf8'));
    return data;
  }
  return {};
}

// Extract metadata from KML file (simplified version focused on core data)
function extractKmlInfoFromFile(filePath, filename) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    
    let registration = '';
    let date = '';
    let time = '';

    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    const kmlRoot = doc || xml.kml;
    
    // Determine KML source
    const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
    console.log(`[KML SOURCE] ${filename}: ${isFlightRadar24 ? 'FlightRadar24' : 'ADS-B Exchange'}`);
    
    if (isFlightRadar24) {
      // FlightRadar24: extract registration from document name
      if (doc.name) {
        const regMatch = doc.name.match(/[A-Z]{2}[A-Z0-9]{3}$/);
        if (regMatch) {
          const rawReg = regMatch[0];
          registration = rawReg.slice(0, 2) + '-' + rawReg.slice(2);
          console.log(`[KML REGEX] Matched registration in name: ${registration}`);
        }
      }
      
      // FlightRadar24: extract date/time from Placemark name
      if (kmlRoot && kmlRoot.Folder) {
        const folders = Array.isArray(kmlRoot.Folder) ? kmlRoot.Folder : [kmlRoot.Folder];
        for (const folder of folders) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              if (pm.name) {
                const dtMatch = pm.name.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
                if (dtMatch) {
                  date = dtMatch[1];
                  time = dtMatch[2];
                  console.log(`[KML REGEX] Matched date/time in Placemark name: ${date} ${time}`);
                  break;
                }
              }
            }
            if (date && time) break;
          }
        }
      }
    } else {
      // ADS-B Exchange: extract registration from Placemark name
      if (kmlRoot && kmlRoot.Folder) {
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          foldersToSearch = Array.isArray(kmlRoot.Folder.Folder) ? kmlRoot.Folder.Folder : [kmlRoot.Folder.Folder];
        } else {
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              if (pm.name) {
                const regMatch = pm.name.match(/^([A-Z0-9]{2}-[A-Z0-9]{2,3})$/);
                if (regMatch) {
                  registration = regMatch[1];
                  console.log(`[KML REGEX] Matched registration in Placemark name: ${registration}`);
                  break;
                }
              }
            }
            if (registration) break;
          }
        }
      }
      
      // ADS-B Exchange: extract date/time from gx:Track when elements
      if (kmlRoot && kmlRoot.Folder) {
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          foldersToSearch = Array.isArray(kmlRoot.Folder.Folder) ? kmlRoot.Folder.Folder : [kmlRoot.Folder.Folder];
        } else {
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              if (pm['gx:Track'] && pm['gx:Track'].when) {
                const whenElements = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
                if (whenElements.length > 0) {
                  const firstWhen = whenElements[0];
                  const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
                  if (whenMatch) {
                    date = whenMatch[1];
                    time = whenMatch[2];
                    console.log(`[KML REGEX] Matched date/time in gx:Track when: ${date} ${time}`);
                    break;
                  }
                }
              }
            }
            if (date && time) break;
          }
        }
      }
    }

    // Fallback: extract date from filename
    if (!date) {
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
        time = time || '00:00';
      }
    }

    console.log(`[KML DEBUG] ${filename}: registration=${registration}, date=${date}, time=${time}`);
    return { filename, registration, date, time };
  } catch (e) {
    console.log(`[KML ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '' };
  }
}

async function generateMasterMetadata() {
  console.log('🚀 Generating master metadata file...');
  console.log('');
  
  // Load helicopter metadata
  const helicopterMetadata = loadHelicopterMetadata();
  console.log(`📊 Loaded helicopter data for ${Object.keys(helicopterMetadata).length} registrations`);
  
  // Check if uploads directory exists
  if (!fs.existsSync(uploadsDir)) {
    console.log('⚠️ Uploads directory not found - creating empty master metadata');
    const metadata = {
      generated: new Date().toISOString(),
      totalFiles: 0,
      validFlights: 0,
      flights: []
    };
    
    // Ensure server directory exists
    const serverDir = path.dirname(masterMetadataFile);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    
    fs.writeFileSync(masterMetadataFile, JSON.stringify(metadata, null, 2));
    console.log('✅ Empty master metadata file created for deployment');
    return;
  }
  
  // Get all KML files
  const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
  console.log(`📁 Found ${files.length} KML files to process`);
  console.log('');
  
  // Process all files
  const allFlights = [];
  files.forEach((filename, idx) => {
    if (idx % 50 === 0) {
      console.log(`Processing file ${idx + 1}/${files.length}...`);
    }
    
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfoFromFile(filePath, filename);
    
    // Only include flights with valid registration
    if (meta.registration) {
      const heliData = helicopterMetadata[meta.registration] || {};
      
      allFlights.push({
        filename: meta.filename,
        registration: meta.registration,
        date: meta.date,
        time: meta.time,
        owner: heliData.owner || '',
        imageUrl: heliData.imageUrl || ''
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
  
  console.log('');
  console.log('✅ Master metadata generated successfully!');
  console.log(`📊 Summary:`);
  console.log(`   • Total KML files: ${files.length}`);
  console.log(`   • Valid flights: ${allFlights.length}`);
  console.log(`   • Excluded files: ${files.length - allFlights.length} (missing registration)`);
  console.log(`   • File size: ${Math.round(fs.statSync(masterMetadataFile).size / 1024)} KB`);
  console.log(`   • Output: ${path.relative(process.cwd(), masterMetadataFile)}`);
  console.log('');
  console.log('🚀 Server can now start quickly by reading this file!');
}

// Run if called directly
if (require.main === module) {
  generateMasterMetadata().catch(console.error);
}

module.exports = { generateMasterMetadata }; 