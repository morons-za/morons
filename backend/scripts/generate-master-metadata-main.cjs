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

const uploadsDir = path.join(__dirname, '..', 'uploads');
const helicoptersFile = path.join(__dirname, 'helicopters.json');
const masterMetadataFile = path.join(__dirname, 'master-metadata.json');
const staticMasterMetadataFile = path.join(__dirname, '..', '..', 'static-site', 'master-metadata.json');

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
    let owner = '';

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

    // Fallback: search raw content for Start (SAST) timestamp (server-generated KMLs
    // embed this deep in the file, after a large TMNP boundary polygon)
    if (!time || time === '00:00') {
      const sastMatch = xmlData.match(/Start \(SAST\):\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/);
      if (sastMatch) {
        if (!date) date = sastMatch[1];
        const hSast = parseInt(sastMatch[2], 10);
        const mSast = parseInt(sastMatch[3], 10);
        const hUtc = ((hSast - 2) + 24) % 24;
        time = `${String(hUtc).padStart(2, '0')}:${String(mSast).padStart(2, '0')}`;
        console.log(`[KML REGEX] Matched Start (SAST) in raw content: ${date} ${time} UTC`);
      }
    }

    // Fallback: search for Entry into TMNP timestamp
    if (!time || time === '00:00') {
      const entryMatch = xmlData.match(/Entry into TMNP.*?at (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/);
      if (entryMatch) {
        if (!date) date = entryMatch[1];
        const hSast = parseInt(entryMatch[2], 10);
        const mSast = parseInt(entryMatch[3], 10);
        const hUtc = ((hSast - 2) + 24) % 24;
        time = `${String(hUtc).padStart(2, '0')}:${String(mSast).padStart(2, '0')}`;
        console.log(`[KML REGEX] Matched Entry into TMNP in raw content: ${date} ${time} UTC`);
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

    // Extract owner information from KML description
    if (doc && doc.description) {
      const description = doc.description;
      // Look for "Private owner" or other owner patterns in the description
      if (description.includes('Private owner')) {
        owner = 'Private owner';
      } else if (description.includes('Cape Town Helicopters')) {
        owner = 'Cape Town Helicopters';
      } else if (description.includes('Sport Helicopters')) {
        owner = 'Sport Helicopters';
      } else if (description.includes('NAC')) {
        owner = 'NAC';
      }
    }

    console.log(`[KML DEBUG] ${filename}: registration=${registration}, date=${date}, time=${time}, owner=${owner}`);
    return { filename, registration, date, time, owner };
  } catch (e) {
    console.log(`[KML ERROR] ${filename}:`, e.message);
    return { filename, registration: '', date: '', time: '', owner: '' };
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
  const excludedFiles = [];
  
  files.forEach((filename, idx) => {
    if (idx % 50 === 0) {
      console.log(`Processing file ${idx + 1}/${files.length}...`);
    }
    
    const filePath = path.join(uploadsDir, filename);
    const meta = extractKmlInfoFromFile(filePath, filename);
    
    // Only include flights with valid registration
    if (meta.registration) {
      const heliData = helicopterMetadata[meta.registration] || {};
      
      // Calculate file size in MB
      const fileSizeBytes = fs.statSync(filePath).size;
      const fileSizeMB = parseFloat((fileSizeBytes / (1024 * 1024)).toFixed(2));
      
      // Priority: helicopters.json (curated data) > KML extraction (FlightRadar24)
      // This allows manual research to override generic "Private owner" from KML
      allFlights.push({
        filename: meta.filename,
        registration: meta.registration,
        date: meta.date,
        time: meta.time,
        owner: heliData.owner || meta.owner || '',
        imageUrl: heliData.imageUrl || '',
        fileSizeMB: fileSizeMB
      });
    } else {
      // Track excluded files for debugging
      excludedFiles.push({
        filename: filename,
        reason: 'No registration extracted',
        meta: meta
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
  
  // Debug: Show excluded files
  if (excludedFiles.length > 0) {
    console.log(`\n🔍 Debug - Excluded files (${excludedFiles.length}):`);
    excludedFiles.slice(0, 10).forEach(file => {
      console.log(`   • ${file.filename} - ${file.reason}`);
    });
    if (excludedFiles.length > 10) {
      console.log(`   • ... and ${excludedFiles.length - 10} more files`);
    }
  }
  
  // Calculate total file size
  const totalSizeMB = allFlights.reduce((sum, flight) => sum + flight.fileSizeMB, 0);
  console.log(`   • Total flight data: ${totalSizeMB.toFixed(2)} MB`);
  console.log(`   • Average file size: ${(totalSizeMB / allFlights.length).toFixed(2)} MB`);
  
  console.log(`   • Metadata file size: ${Math.round(fs.statSync(masterMetadataFile).size / 1024)} KB`);
  console.log(`   • Output: ${path.relative(process.cwd(), masterMetadataFile)}`);
  console.log('');
  console.log('🚀 Server can now start quickly by reading this file!');
}

// Run if called directly
if (require.main === module) {
  generateMasterMetadata().catch(console.error);
}

// Incremental update function - only processes new files
// Accepts either:
//   - newFilenames: array of KML filenames to parse from uploads/
//   - flightRecords: array of pre-computed { filename, registration, date, time } objects
//     (skips KML parsing entirely — used by daily-sync which already has all metadata)
async function updateMasterMetadataIncremental(newFilenames = null, { flightRecords } = {}) {
  console.log('🔄 Incrementally updating master metadata...');
  const persistMetadata = (metadata) => {
    const serverDir = path.dirname(masterMetadataFile);
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    fs.writeFileSync(masterMetadataFile, JSON.stringify(metadata, null, 2));
  };

  let existingMetadata = {
    generated: new Date().toISOString(),
    totalFiles: 0,
    validFlights: 0,
    flights: []
  };

  // Choose the freshest metadata baseline (largest flight set) to avoid
  // regressions when one metadata file is stale.
  const metadataCandidates = [masterMetadataFile, staticMasterMetadataFile]
    .filter((p) => fs.existsSync(p))
    .map((p) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        const flights = Array.isArray(parsed?.flights) ? parsed.flights : [];
        return { path: p, parsed, count: flights.length };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);

  if (metadataCandidates.length > 0) {
    existingMetadata = metadataCandidates[0].parsed;
    const sourceLabel = metadataCandidates[0].path === staticMasterMetadataFile
      ? 'static-site/master-metadata.json'
      : 'backend/scripts/master-metadata.json';
    console.log(`📋 Loaded existing metadata from ${sourceLabel} with ${existingMetadata.flights.length} flights`);
  }

  const existingFilenames = new Set(existingMetadata.flights.map(f => f.filename));
  const helicopterMetadata = loadHelicopterMetadata();

  const newFlights = [];

  if (flightRecords && flightRecords.length > 0) {
    // Fast path with safety net: trust pre-computed records, but fill missing
    // fields from KML so time/registration regressions cannot creep back in.
    for (const rec of flightRecords) {
      if (existingFilenames.has(rec.filename)) continue;
      const filePath = path.join(uploadsDir, rec.filename);

      let parsed = null;
      const hasWeakRecord =
        !rec.registration ||
        !rec.date ||
        !rec.time ||
        String(rec.time).trim() === '00:00';
      if (hasWeakRecord && fs.existsSync(filePath)) {
        parsed = extractKmlInfoFromFile(filePath, rec.filename);
      }

      const filenameRegMatch = String(rec.filename || '').match(/-(?:[0-9]{8}-)?([A-Z]{2}-[A-Z0-9]{3})-/);
      const registration = rec.registration || parsed?.registration || (filenameRegMatch ? filenameRegMatch[1] : '');
      if (!registration) {
        console.log(`⚠️ Excluded flightRecord ${rec.filename} (no registration)`);
        continue;
      }

      const filenameDateMatch = String(rec.filename || '').match(/^(\d{4}-\d{2}-\d{2})-/);
      const date = rec.date || parsed?.date || (filenameDateMatch ? filenameDateMatch[1] : '');
      const time = (rec.time && String(rec.time).trim() !== '00:00')
        ? rec.time
        : (parsed?.time || '00:00');

      const heliData = helicopterMetadata[registration] || {};
      let fileSizeMB = 0;
      try { fileSizeMB = parseFloat((fs.statSync(filePath).size / (1024 * 1024)).toFixed(2)); } catch {}
      newFlights.push({
        filename: rec.filename,
        registration,
        date,
        time,
        owner: heliData.owner || rec.owner || parsed?.owner || '',
        imageUrl: heliData.imageUrl || '',
        fileSizeMB
      });
    }
    console.log(`📁 Added ${newFlights.length} flight(s) from pre-computed records`);
  } else {
    // Slow path: parse KML files from disk
    let filesToProcess = [];

    if (newFilenames && newFilenames.length > 0) {
      filesToProcess = newFilenames.filter(f => !existingFilenames.has(f));
      console.log(`📁 Processing ${filesToProcess.length} specified new file(s)`);
    } else {
      const allFiles = fs.existsSync(uploadsDir)
        ? fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'))
        : [];
      filesToProcess = allFiles.filter(f => !existingFilenames.has(f));
      console.log(`📁 Found ${filesToProcess.length} new file(s) to process`);
    }

    if (filesToProcess.length === 0) {
      console.log('✅ No new files to process - metadata is up to date');
      persistMetadata(existingMetadata);
      return existingMetadata;
    }

    const excludedFiles = [];
    filesToProcess.forEach((filename) => {
      const filePath = path.join(uploadsDir, filename);
      if (!fs.existsSync(filePath)) { console.log(`⚠️ File not found: ${filename}`); return; }

      const meta = extractKmlInfoFromFile(filePath, filename);
      if (meta.registration) {
        const heliData = helicopterMetadata[meta.registration] || {};
        const fileSizeMB = parseFloat((fs.statSync(filePath).size / (1024 * 1024)).toFixed(2));
        newFlights.push({
          filename: meta.filename,
          registration: meta.registration,
          date: meta.date,
          time: meta.time,
          owner: heliData.owner || meta.owner || '',
          imageUrl: heliData.imageUrl || '',
          fileSizeMB
        });
      } else {
        excludedFiles.push(filename);
      }
    });

    if (excludedFiles.length > 0) {
      console.log(`⚠️ Excluded ${excludedFiles.length} file(s) (no registration): ${excludedFiles.join(', ')}`);
    }
  }

  if (newFlights.length === 0) {
    console.log('✅ No new flights to add');
    persistMetadata(existingMetadata);
    return existingMetadata;
  }

  const allFlights = [...existingMetadata.flights, ...newFlights];
  allFlights.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    return b.time.localeCompare(a.time);
  });

  const updatedMetadata = {
    generated: new Date().toISOString(),
    totalFiles: allFlights.length,
    validFlights: allFlights.length,
    flights: allFlights
  };

  const serverDir = path.dirname(masterMetadataFile);
  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(masterMetadataFile, JSON.stringify(updatedMetadata, null, 2));

  console.log(`✅ Metadata updated: +${newFlights.length} flights, ${allFlights.length} total`);
  return updatedMetadata;
}

module.exports = { generateMasterMetadata, updateMasterMetadataIncremental, extractKmlInfoFromFile };