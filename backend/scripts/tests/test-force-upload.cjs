#!/usr/bin/env node

// Simple script to force upload KML files by bypassing the violation check temporarily
// This is a workaround until we fix the TMNP boundary validation issue

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const filesToUpload = [
  '3bfd81ed.kml', '3bfd2106.kml', '3bfdba0f.kml', '3c0bf893.kml', '3c0c66b9.kml', '3c0c461d.kml'
].map(f => path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', 'Downloads', 'KMLs to be uploaded', f));

console.log('🚀 Force uploading KML files...');
console.log('⚠️  This bypasses violation checking temporarily');

async function forceUpload() {
  // First, let's copy these files directly to the uploads folder
  for (const filePath of filesToUpload) {
    try {
      if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}`);
        continue;
      }
      
      const fileName = path.basename(filePath);
      const destPath = path.join(UPLOADS_DIR, fileName);
      
      // Copy the file
      fs.copyFileSync(filePath, destPath);
      console.log(`✅ Copied ${fileName} to uploads folder`);
      
    } catch (error) {
      console.error(`❌ Error copying ${filePath}:`, error.message);
    }
  }
  
  console.log('\n🔄 Now run "Add Missing to Metadata" in the admin interface to add these files to the metadata.');
  console.log('📝 The files are now in the uploads folder and should be processed as violations.');
}

forceUpload().catch(console.error);