// Load environment variables first
require('dotenv').config();

const { Storage } = require('@google-cloud/storage');

// Debug logging (commented out for production)
// console.log('🔍 GCS Config Debug:');
// console.log('  - Current working directory:', process.cwd());
// console.log('  - GCS_BUCKET_NAME env var:', process.env.GCS_BUCKET_NAME);
// console.log('  - GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);

// Initialize Google Cloud Storage
const storage = new Storage({
  // If you have a service account key file, specify it here:
  // keyFilename: './path/to/your/service-account-key.json',
  
  // Or use default credentials (recommended for production):
  // This will use GOOGLE_APPLICATION_CREDENTIALS environment variable
  // or default service account if running on Google Cloud
});

// Your GCS bucket name - replace with your actual bucket name
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'heli-map-bucket';

// Get bucket reference
const bucket = storage.bucket(BUCKET_NAME);

// Helper function to get public URL for a file
function getPublicUrl(filename) {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;
}

// Helper function to upload a file to GCS
async function uploadToGCS(filePath, destination, contentType = null) {
  try {
    const options = {
      destination: destination,
      metadata: {
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      }
    };
    
    if (contentType) {
      options.metadata.contentType = contentType;
    }
    
    const [file] = await bucket.upload(filePath, options);
    
    // Make the file publicly readable
    await file.makePublic();
    
    console.log(`✅ File uploaded to GCS: ${destination}`);
    return getPublicUrl(destination);
    
  } catch (error) {
    console.error(`❌ Error uploading to GCS: ${error.message}`);
    throw error;
  }
}

// Helper function to delete a file from GCS
async function deleteFromGCS(filename) {
  try {
    await bucket.file(filename).delete();
    console.log(`✅ File deleted from GCS: ${filename}`);
  } catch (error) {
    console.error(`❌ Error deleting from GCS: ${error.message}`);
    throw error;
  }
}

// Debug exports (commented out for production)
// console.log('🔍 Exporting module with:');
// console.log('  - storage:', typeof storage);
// console.log('  - bucket:', typeof bucket);
// console.log('  - BUCKET_NAME:', BUCKET_NAME);
// console.log('  - getPublicUrl:', typeof getPublicUrl);
// console.log('  - uploadToGCS:', typeof uploadToGCS);
// console.log('  - deleteFromGCS:', typeof deleteFromGCS);

module.exports = {
  storage,
  bucket,
  BUCKET_NAME,
  getPublicUrl,
  uploadToGCS,
  deleteFromGCS
};
