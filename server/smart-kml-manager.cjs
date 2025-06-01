const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

class SmartKMLManager {
  constructor() {
    this.uploadsDir = path.join(__dirname, 'uploads');
    this.cacheFile = path.join(__dirname, 'kml-metadata-cache.json');
    this.processedFile = path.join(__dirname, 'processed-files.json');
    this.duplicatesFile = path.join(__dirname, 'duplicate-files.json');
  }

  // Load list of previously processed files
  loadProcessedFiles() {
    if (fs.existsSync(this.processedFile)) {
      return JSON.parse(fs.readFileSync(this.processedFile, 'utf8'));
    }
    return { files: {}, lastScan: null };
  }

  // Save list of processed files
  saveProcessedFiles(processed) {
    fs.writeFileSync(this.processedFile, JSON.stringify(processed, null, 2));
  }

  // Generate content hash for duplicate detection
  generateContentHash(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Remove timestamps and dynamic content that might vary between identical flights
      const normalizedContent = content
        .replace(/<when>[^<]*<\/when>/g, '') // Remove timestamp elements
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      return crypto.createHash('md5').update(normalizedContent).digest('hex');
    } catch (error) {
      console.log(`❌ Error generating hash for ${path.basename(filePath)}: ${error.message}`);
      return null;
    }
  }

  // Generate unique ID for files that don't have one
  generateUniqueId() {
    return crypto.randomBytes(4).toString('hex');
  }

  // Extract metadata from KML file (using existing logic)
  extractKmlMetadata(filePath, filename) {
    try {
      const xmlData = fs.readFileSync(filePath, 'utf8');
      const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
      const xml = parser.parse(xmlData);
      
      let registration = '';
      let date = '';
      let time = '';

      const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
      const kmlRoot = doc || xml.kml;
      
      // Determine KML source and extract accordingly
      const isFlightRadar24 = doc && doc.name && doc.name.includes('/Z');
      const isAdsb = filename.includes('track') || (!doc && xml.kml.Folder);
      
      if (isFlightRadar24) {
        // FlightRadar24 parsing logic
        if (doc.name) {
          // Handle formats like "-/ZSHMB" or "FlightRadar24/ZSHMB"
          const regMatch = doc.name.match(/[A-Z]{2}[A-Z0-9]{3}$/);
          if (regMatch) {
            const rawReg = regMatch[0]; // e.g., "ZSHMB"
            // Convert to proper format: ZSHMB -> ZS-HMB
            registration = rawReg.slice(0, 2) + '-' + rawReg.slice(2);
          }
        }
      } else if (isAdsb) {
        // ADS-B Exchange parsing logic
        if (kmlRoot && kmlRoot.Folder) {
          let foldersToSearch = [];
          
          if (kmlRoot.Folder.Folder) {
            if (Array.isArray(kmlRoot.Folder.Folder)) {
              foldersToSearch = kmlRoot.Folder.Folder;
            } else {
              foldersToSearch = [kmlRoot.Folder.Folder];
            }
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
                    break;
                  }
                }
              }
              if (registration) break;
            }
          }
        }
        
        // Also try to extract from filename
        if (!registration) {
          const fileRegMatch = filename.match(/^([A-Z0-9]{2}-[A-Z0-9]{2,3})/);
          if (fileRegMatch) {
            registration = fileRegMatch[1];
          }
        }
      }

      // Date/Time extraction for both formats
      if (kmlRoot && kmlRoot.Folder) {
        let foldersToSearch = [];
        
        if (kmlRoot.Folder.Folder) {
          if (Array.isArray(kmlRoot.Folder.Folder)) {
            foldersToSearch = kmlRoot.Folder.Folder;
          } else {
            foldersToSearch = [kmlRoot.Folder.Folder];
          }
        } else {
          const folderKeys = Object.keys(kmlRoot.Folder).filter(key => !isNaN(key));
          foldersToSearch = folderKeys.map(key => kmlRoot.Folder[key]);
        }
        
        for (const folder of foldersToSearch) {
          if (folder.Placemark) {
            const placemarks = Array.isArray(folder.Placemark) ? folder.Placemark : [folder.Placemark];
            for (const pm of placemarks) {
              // Check for gx:Track when elements (ADS-B Exchange)
              if (pm['gx:Track'] && pm['gx:Track'].when) {
                const whenElements = Array.isArray(pm['gx:Track'].when) ? pm['gx:Track'].when : [pm['gx:Track'].when];
                if (whenElements.length > 0) {
                  const firstWhen = whenElements[0];
                  const whenMatch = firstWhen.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
                  if (whenMatch) {
                    date = whenMatch[1];
                    time = whenMatch[2];
                    break;
                  }
                }
              }
              // Check for FlightRadar24 timestamp format
              if (pm.name) {
                const dtMatch = pm.name.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
                if (dtMatch) {
                  date = dtMatch[1];
                  time = dtMatch[2];
                  break;
                }
              }
            }
            if (date && time) break;
          }
        }
      }

      // Fallback: try to extract date from filename
      if (!date) {
        const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          date = dateMatch[1];
          time = time || '00:00'; // Default time if not found
        }
      }

      return { registration, date, time };
    } catch (error) {
      console.log(`❌ Error parsing ${filename}: ${error.message}`);
      return { registration: '', date: '', time: '' };
    }
  }

  // Create organized filename
  createOrganizedFilename(metadata, originalFilename) {
    const { registration, date } = metadata;
    
    // Extract or generate unique ID
    let uniqueId = '';
    
    // Try to extract existing ID from various patterns
    const patterns = [
      /([a-f0-9]{8})\.kml$/i, // 8-char hex
      /([a-f0-9]{6,})\.kml$/i, // 6+ char hex
      /track-(\w+)\.kml$/i, // track-ID pattern
      /-(\w{3,})\.kml$/i, // ending with dash-ID
    ];
    
    for (const pattern of patterns) {
      const match = originalFilename.match(pattern);
      if (match && !match[1].includes('copy') && !match[1].match(/^\d+$/)) {
        uniqueId = match[1];
        break;
      }
    }
    
    // Generate new ID if none found
    if (!uniqueId) {
      uniqueId = this.generateUniqueId();
    }
    
    // Clean registration
    const cleanReg = registration && registration !== '-' ? 
      registration.replace(/[^A-Z0-9-]/g, '') : 'UNKNOWN';
    
    // Use date or fallback
    const dateStr = date && date !== '-' ? date : 'UNKNOWN-DATE';
    
    return `${dateStr}-${cleanReg}-${uniqueId}.kml`;
  }

  // Process new files
  async processNewFiles() {
    console.log('🔍 Smart KML Manager: Scanning for new files...');
    
    const processed = this.loadProcessedFiles();
    const allFiles = fs.readdirSync(this.uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
    const newFiles = allFiles.filter(f => !processed.files[f]);
    
    console.log(`📁 Found ${allFiles.length} total KML files, ${newFiles.length} new files to process`);
    
    if (newFiles.length === 0) {
      console.log('✅ No new files to process');
      return { processed: 0, renamed: 0, duplicates: 0 };
    }

    const duplicates = [];
    const contentHashes = new Map();
    let renamed = 0;
    
    // Load existing hashes from processed files (not cache)
    for (const [filename, fileInfo] of Object.entries(processed.files)) {
      if (fileInfo.contentHash) {
        contentHashes.set(fileInfo.contentHash, filename);
      }
    }

    for (const filename of newFiles) {
      try {
        const filePath = path.join(this.uploadsDir, filename);
        
        // Generate content hash
        const contentHash = this.generateContentHash(filePath);
        if (!contentHash) continue;
        
        // Check for duplicates against existing processed files
        if (contentHashes.has(contentHash)) {
          const existingFile = contentHashes.get(contentHash);
          console.log(`🔄 Duplicate detected: ${filename} matches ${existingFile}`);
          duplicates.push({ file: filename, duplicateOf: existingFile });
          
          // Move duplicate to a duplicates folder
          const duplicatesDir = path.join(this.uploadsDir, '../duplicates');
          if (!fs.existsSync(duplicatesDir)) fs.mkdirSync(duplicatesDir);
          fs.renameSync(filePath, path.join(duplicatesDir, filename));
          continue;
        }
        
        // Extract metadata
        const metadata = this.extractKmlMetadata(filePath, filename);
        
        // Create organized filename
        const newFilename = this.createOrganizedFilename(metadata, filename);
        const newPath = path.join(this.uploadsDir, newFilename);
        
        // Rename if needed and target doesn't exist
        if (filename !== newFilename && !fs.existsSync(newPath)) {
          fs.renameSync(filePath, newPath);
          console.log(`📝 Renamed: ${filename} → ${newFilename}`);
          renamed++;
          
          // Update processed files tracking with new filename
          processed.files[newFilename] = {
            originalName: filename,
            processedAt: new Date().toISOString(),
            contentHash: contentHash,
            metadata: metadata
          };
          
          // Store hash for future duplicate detection
          contentHashes.set(contentHash, newFilename);
        } else {
          // File doesn't need renaming or target exists
          processed.files[filename] = {
            originalName: filename,
            processedAt: new Date().toISOString(),
            contentHash: contentHash,
            metadata: metadata
          };
          
          // Store hash for future duplicate detection
          contentHashes.set(contentHash, filename);
        }
        
      } catch (error) {
        console.log(`❌ Error processing ${filename}: ${error.message}`);
      }
    }

    // Save processed files list
    processed.lastScan = new Date().toISOString();
    this.saveProcessedFiles(processed);
    
    // Invalidate main server cache if we processed any files
    if (newFiles.length > 0) {
      const serverCacheFile = path.join(__dirname, 'kml-metadata-cache.json');
      if (fs.existsSync(serverCacheFile)) {
        try {
          // fs.unlinkSync(serverCacheFile);
          // console.log(`🗑️ Invalidated server metadata cache (${newFiles.length} new files processed)`);
          console.log(`📝 Note: ${newFiles.length} new files processed. Use hot-reload endpoint or restart server to update metadata.`);
        } catch (e) {
          console.log(`⚠️ Could not invalidate cache: ${e.message}`);
        }
      }
    }
    
    // Save duplicates log
    if (duplicates.length > 0) {
      fs.writeFileSync(this.duplicatesFile, JSON.stringify(duplicates, null, 2));
    }

    console.log(`📊 Processing complete:`);
    console.log(`  ✅ Processed: ${newFiles.length} new files`);
    console.log(`  📝 Renamed: ${renamed} files`);
    console.log(`  🔄 Duplicates found: ${duplicates.length} files`);
    
    return { processed: newFiles.length, renamed, duplicates: duplicates.length };
  }
}

// CLI interface
async function main() {
  const manager = new SmartKMLManager();
  const command = process.argv[2];
  
  if (command === 'process') {
    await manager.processNewFiles();
  } else {
    console.log(`
🧠 Smart KML Manager

Usage:
  node smart-kml-manager.cjs process  - Process new KML files

Features:
  ✅ Detects new files only (doesn't reprocess existing)
  ✅ Identifies and removes duplicates
  ✅ Auto-generates unique IDs for files without them
  ✅ Organizes filenames: YYYY-MM-DD-REGISTRATION-ID.kml
  ✅ Tracks processing history
    `);
  }
}

if (require.main === module) {
  main();
}

module.exports = SmartKMLManager; 