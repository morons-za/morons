#!/usr/bin/env node

/**
 * Sync script for KML uploads between local development and production
 * Usage: node sync-uploads.js [upload|download]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PRODUCTION_URL = 'https://your-production-domain.com'; // Update with your actual production URL
const LOCAL_UPLOADS_DIR = path.join(__dirname, 'server', 'uploads');

async function fetchProductionUploads() {
  return new Promise((resolve, reject) => {
    https.get(`${PRODUCTION_URL}/uploads`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete the file async
      reject(err);
    });
  });
}

async function syncDown() {
  console.log('🔄 Syncing KML files from production to local...');
  
  try {
    const productionFiles = await fetchProductionUploads();
    const localFiles = fs.existsSync(LOCAL_UPLOADS_DIR) 
      ? fs.readdirSync(LOCAL_UPLOADS_DIR).filter(f => f.endsWith('.kml'))
      : [];
    
    // Ensure uploads directory exists
    if (!fs.existsSync(LOCAL_UPLOADS_DIR)) {
      fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
    }
    
    let downloaded = 0;
    
    for (const file of productionFiles) {
      if (!localFiles.includes(file.filename)) {
        console.log(`📥 Downloading ${file.filename}...`);
        await downloadFile(
          `${PRODUCTION_URL}${file.url}`,
          path.join(LOCAL_UPLOADS_DIR, file.filename)
        );
        downloaded++;
      }
    }
    
    console.log(`✅ Downloaded ${downloaded} new files. Local is now in sync with production.`);
  } catch (error) {
    console.error('❌ Error syncing from production:', error.message);
  }
}

async function listComparison() {
  console.log('📊 Comparing local vs production KML files...\n');
  
  try {
    const productionFiles = await fetchProductionUploads();
    const localFiles = fs.existsSync(LOCAL_UPLOADS_DIR) 
      ? fs.readdirSync(LOCAL_UPLOADS_DIR).filter(f => f.endsWith('.kml'))
      : [];
    
    const prodFilenames = productionFiles.map(f => f.filename);
    const localOnly = localFiles.filter(f => !prodFilenames.includes(f));
    const prodOnly = prodFilenames.filter(f => !localFiles.includes(f));
    const common = localFiles.filter(f => prodFilenames.includes(f));
    
    console.log(`📍 Production: ${prodFilenames.length} files`);
    console.log(`💻 Local: ${localFiles.length} files`);
    console.log(`🤝 Common: ${common.length} files`);
    
    if (localOnly.length > 0) {
      console.log(`\n📱 Local only (${localOnly.length}):`);
      localOnly.forEach(f => console.log(`  - ${f}`));
    }
    
    if (prodOnly.length > 0) {
      console.log(`\n☁️  Production only (${prodOnly.length}):`);
      prodOnly.forEach(f => console.log(`  - ${f}`));
    }
    
    if (localOnly.length === 0 && prodOnly.length === 0) {
      console.log('\n✅ Local and production are perfectly in sync!');
    }
    
  } catch (error) {
    console.error('❌ Error comparing files:', error.message);
  }
}

// Main execution
const command = process.argv[2];

if (command === 'download' || command === 'sync') {
  syncDown();
} else if (command === 'compare' || command === 'status') {
  listComparison();
} else {
  console.log(`
🔄 KML Upload Sync Tool

Usage:
  node sync-uploads.js download    # Download missing files from production
  node sync-uploads.js compare     # Compare local vs production files
  
Examples:
  node sync-uploads.js download    # Sync production files to local
  node sync-uploads.js compare     # See what's different
`);
} 