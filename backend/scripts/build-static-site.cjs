#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building Static Site for TMNP Helicopter Tracking...\n');

// Configuration
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const BUILD_DIR = path.join(PROJECT_ROOT, 'static-site');
const SOURCE_DIRS = {
  tmnpBoundaryPrimary: path.join(PROJECT_ROOT, 'static-site', 'tmnp.kml'),
  tmnpBoundaryFallback: path.join(PROJECT_ROOT, 'static-site', 'tmnp.kml')
};

// Prepare build directory (preserve optimized KMLs)
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}
console.log('🧹 Cleaning build subdirectories (preserving kml-optimised)...');
// Ensure optimized folder exists (do not delete contents)
fs.mkdirSync(path.join(BUILD_DIR, 'kml-optimised'), { recursive: true });

console.log('📁 Build directory ready');

// Copy static assets
console.log('\n📋 Copying static assets...');

// Copy TMNP boundary (prefer public/, fallback to existing static-site root)
const boundaryDest = path.join(BUILD_DIR, 'tmnp.kml');
let boundarySource = null;
if (fs.existsSync(SOURCE_DIRS.tmnpBoundaryPrimary)) {
  boundarySource = SOURCE_DIRS.tmnpBoundaryPrimary;
} else if (fs.existsSync(SOURCE_DIRS.tmnpBoundaryFallback)) {
  boundarySource = SOURCE_DIRS.tmnpBoundaryFallback;
}
if (boundarySource) {
  if (path.resolve(boundarySource) !== path.resolve(boundaryDest)) {
    fs.copyFileSync(boundarySource, boundaryDest);
    console.log('✅ TMNP boundary copied');
  } else {
    console.log('✅ TMNP boundary already in place');
  }
} else {
  console.log('⚠️  TMNP boundary file not found');
}

// Copy PDF documents (prefer public/, fallback to existing static-site root)
console.log('📄 Ensuring PDF documents present...');
const pdfFiles = ['NEMPAA.pdf', 'NP17.pdf'];

pdfFiles.forEach(pdfFile => {
  const publicPath = path.join('public', pdfFile);
  const staticPath = path.join(BUILD_DIR, pdfFile);
  if (fs.existsSync(publicPath)) {
    fs.copyFileSync(publicPath, staticPath);
    console.log(`✅ Copied ${pdfFile} from public/`);
  } else if (fs.existsSync(staticPath)) {
    console.log(`✅ ${pdfFile} already present in static-site/`);
  } else {
    console.log(`⚠️  ${pdfFile} not found in public/ or static-site/`);
  }
});

// Note: Original KML files are served from GitHub raw URLs, not copied to static-site
// The app.js references: https://raw.githubusercontent.com/werneravr/heli-map/main/backend/uploads/
console.log('📁 Original KML files served from GitHub raw URLs (not copied locally)');
// Note: PNG flight maps are served from GitHub media URLs, not copied to static-site
// The app.js references: https://media.githubusercontent.com/media/werneravr/heli-map/main/backend/flight-maps/
console.log('📸 PNG flight maps served from GitHub media URLs (not copied locally)');

// Ensure optimized KML directory exists (optimized files are created by separate process)
const optimizedDir = path.join(BUILD_DIR, 'kml-optimised');
fs.mkdirSync(optimizedDir, { recursive: true });
console.log('✅ Optimized KML directory ready');

// Load TMNP boundary KML for embedding
console.log('\n📄 Loading TMNP boundary KML for embedding...');
let tmnpKmlContent = '';
try {
  const tmnpPath = path.join(BUILD_DIR, 'tmnp.kml');
  if (fs.existsSync(tmnpPath)) {
    tmnpKmlContent = fs.readFileSync(tmnpPath, 'utf8');
    console.log('✅ TMNP boundary KML loaded successfully');
  } else {
    console.log('⚠️  TMNP boundary KML not found at', tmnpPath);
  }
} catch (error) {
  console.error('❌ Error loading TMNP boundary KML:', error.message);
}

// Load flight metadata
console.log('\n📊 Loading flight metadata...');
let flightData = [];

try {
  // Try to load from master metadata first
  const metadataPath = path.join(__dirname, 'master-metadata.json');
  if (fs.existsSync(metadataPath)) {
    const masterMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    console.log('✅ Loaded master metadata');
    
    // Handle both array and object formats
    if (Array.isArray(masterMetadata.flights)) {
      flightData = masterMetadata.flights.filter(flight => 
        flight && flight.filename && flight.registration
      );
    } else {
      // Convert to flat array format for object-based metadata
      flightData = Object.values(masterMetadata).filter(flight => 
        flight && flight.filename && flight.registration
      );
    }
    
    // Remove duplicate entries based on filename (most reliable method)
    const seenFilenames = new Set();
    const filteredFlights = [];
    
    for (const flight of flightData) {
      if (!seenFilenames.has(flight.filename)) {
        filteredFlights.push(flight);
        seenFilenames.add(flight.filename);
      }
    }
    
    flightData = filteredFlights;
  } else if (fs.existsSync('backend/scripts/kml-metadata-cache.json')) {
    const cacheMetadata = JSON.parse(fs.readFileSync('backend/scripts/kml-metadata-cache.json', 'utf8'));
    console.log('✅ Loaded cache metadata');
    
    // Convert to flat array format
    flightData = Object.values(cacheMetadata).filter(flight => 
      flight && flight.filename && flight.registration
    );
  } else {
    console.log('⚠️  No metadata files found, scanning KML files directly...');
    
    // Fallback: scan KML files directly
    const uploadsPath = path.join(__dirname, '..', 'uploads');
    const kmlFiles = fs.readdirSync(uploadsPath).filter(f => f.endsWith('.kml'));
    flightData = kmlFiles.map(filename => {
      // Extract basic info from filename
      const parts = filename.replace('.kml', '').split('-');
      if (parts.length >= 4) {
        return {
          filename,
          date: parts[0] + '-' + parts[1] + '-' + parts[2],
          registration: parts[3],
          time: '00:00', // Default time
          fileSizeMB: null
        };
      }
      return null;
    }).filter(Boolean);
  }
  
  console.log(`📊 Loaded ${flightData.length} flights`);
} catch (error) {
  console.error('❌ Error loading metadata:', error.message);
  process.exit(1);
}

// Generate timestamp data
const now = new Date();
const buildTimestamp = now.toISOString();
const latestFlightDate = flightData.length > 0 ? 
  flightData.map(f => f.date).sort().slice(-1)[0] : null;

console.log(`🕒 Build timestamp: ${buildTimestamp}`);
console.log(`📅 Latest flight data: ${latestFlightDate}`);

// UTC to South Africa time conversion
function utcToSaTime(date, time) {
  if (!date || !time) return '-';
  // date: '2025-05-03', time: '07:31'
  const utc = new Date(`${date}T${time}:00Z`);
  // South Africa is UTC+2
  const sa = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
  return sa.toISOString().slice(11, 16); // 'HH:MM'
}

// Generate the main HTML file
console.log('\n🌐 Generating static HTML...');

// Read the external JavaScript template file
const appJsTemplatePath = path.join(__dirname, 'app.js.template');
let appJsContent = '';

if (fs.existsSync(appJsTemplatePath)) {
    // Read from template file
    appJsContent = fs.readFileSync(appJsTemplatePath, 'utf8');
} else {
    // Fallback: use the extracted file
    const extractedPath = path.join(__dirname, 'extracted-app.js');
    if (fs.existsSync(extractedPath)) {
        appJsContent = fs.readFileSync(extractedPath, 'utf8');
    } else {
        console.error('❌ No JavaScript template found!');
        process.exit(1);
    }
}

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TMNP Helicopter Tracking - Airspace Violations</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚁</text></svg>">
    <link rel="shortcut icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚁</text></svg>">
    <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚁</text></svg>">
    
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-D3M44NE13E"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-D3M44NE13E');
    </script>
    
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" 
          onerror="this.onerror=null; this.href='data:text/css,/* Leaflet CSS fallback - please ensure internet connection for full functionality */'" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8f9fa;
        }
        
        .header {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(0,0,0,0.1);
            padding: 16px 32px;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            display: flex;
            justify-content: flex-end;
            gap: 16px;
            align-items: center;
        }
        
        .header button {
            background: none;
            border: none;
            color: #007bff;
            font-weight: 600;
            font-size: 16px;
            cursor: pointer;
            padding: 8px 12px;
        }
        
        .main-content {
            padding-top: 70px;
            max-width: 1200px;
            margin: 0 auto;
            padding-left: 20px;
            padding-right: 20px;
        }
        
        .main-title {
            text-align: center;
            margin: 24px 0 16px 0;
            color: #333;
        }
        
        .summary {
            margin: 0 0 18px 0;
            font-size: 18px;
            color: #223;
            font-weight: 500;
            text-align: center;
        }
        
        .summary-text {
            line-height: 1.4;
        }
        
        /* Summary cards below the map (match legacy look) */
        .summary-cards {
            background: #fff;
            border: 1px solid #e0e6ed;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            margin: 20px 0 30px 0;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 20px;
        }
        .summary-card {
            flex: 1;
            text-align: center;
            padding: 16px 12px;
            border-right: 1px solid #e9ecef;
        }
        .summary-card:last-child {
            border-right: none;
        }
        .summary-label {
            font-size: 12px;
            font-weight: 600;
            color: #6c757d;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            text-transform: uppercase;
        }
        .summary-value {
            font-size: 24px;
            font-weight: 700;
            color: #2c3e50;
            line-height: 1;
        }
        
        /* Update schedule notification */
        .update-schedule-notification {
            background: rgba(0, 123, 255, 0.08);
            border: 1px solid rgba(0, 123, 255, 0.2);
            color: #0056b3;
            padding: 12px 18px;
            border-radius: 6px;
            margin: 20px 0;
            text-align: center;
            font-size: 13px;
            font-weight: 500;
        }
        
        #map {
            height: 400px;
            width: 100%;
            margin: 24px 0;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .filters-container {
            width: 100%;
            margin: 0 auto 24px auto;
            max-width: 1000px;
        }
        
        .filters {
            background: #f7f9fa;
            border-radius: 10px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.04);
            padding: 24px;
            margin-bottom: 8px;
            border: 1px solid #e3e8ee;
            transition: padding 0.2s;
        }
        
        .filters.collapsed {
            padding: 16px;
        }
        
        .filters-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 18px;
        }
        
        .filters.collapsed .filters-header {
            margin-bottom: 0;
        }
        
        .filters-title {
            font-weight: 600;
            font-size: 18px;
            color: #223;
            letter-spacing: 0.2px;
        }
        
        .filters-controls {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .filter-summary {
            color: #555;
            font-size: 15px;
        }
        
        .filters-content {
            display: flex;
            gap: 16px;
            margin-top: 8px;
            align-items: center;
            justify-content: flex-start;
            flex-wrap: wrap;
        }
        
        .filter-group {
            position: relative;
            min-width: 160px;
            flex: 0 0 auto;
        }
        
        .filter-group label {
            font-weight: 600;
            display: block;
            margin-bottom: 4px;
        }
        
        .filters input, .filters select {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        .filters button {
            padding: 8px 24px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 15px;
        }
        
        .filters .toggle-btn {
            background: #007bff;
            padding: 6px 18px;
            font-size: 15px;
        }
        
        .filters .clear-btn {
            background: #eee;
            color: #222;
            padding: 6px 12px;
            font-size: 14px;
            font-weight: 500;
        }
        
        .btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
            text-align: center;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: #007bff;
            color: white;
        }
        
        .btn-primary:hover {
            background: #0056b3;
        }
        
        .btn-success {
            background: #28a745;
            color: white;
        }
        
        .btn-success:hover {
            background: #1e7e34;
        }
        
        .btn-info {
            background: #17a2b8;
            color: white;
        }
        
        .btn-info:hover {
            background: #117a8b;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.05);
            margin: 32px auto 0 auto;
            max-width: 800px;
        }
        
        th, td {
            padding: 8px;
            border: 1px solid #ddd;
            text-align: left;
        }
        
        /* Ensure date column doesn't wrap */
        td:first-child {
            white-space: nowrap !important;
            min-width: 100px;
        }
        
        th {
            background: #f0f0f0;
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1000;
            box-shadow: 0 2px 2px -1px rgba(0,0,0,0.1);
        }
        
        tbody tr:hover {
            background: #f8f9fa;
        }
        
        .download-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        
        .view-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .report-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        
        .modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 2rem;
            border-radius: 12px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        
        .close:hover {
            color: #000;
        }
        
        .flight-details {
            margin-top: 1rem;
        }
        
        .flight-map {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin-top: 1rem;
        }
        
        .loading {
            text-align: center;
            color: #007bff;
            margin: 24px 0;
        }
        
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 1rem;
            border-radius: 4px;
            margin: 1rem 0;
        }
        
        @keyframes helicopter-hover {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-3px); }
        }
        
        .helicopter-loader {
            animation: helicopter-hover 1s ease-in-out infinite;
            display: inline-block;
        }
        
        @media (max-width: 768px) {
            .main-title {
                font-size: 1.5rem;
            }
            
            /* Summary cards - stack vertically on mobile */
            .summary-cards {
                flex-direction: column;
                gap: 0;
            }
            
            .summary-card {
                border-right: none;
                border-bottom: 1px solid #e9ecef;
                padding: 12px 16px;
            }
            
            .summary-card:last-child {
                border-bottom: none;
            }
            
            .summary-label {
                font-size: 11px;
                margin-bottom: 6px;
            }
            
            .summary-value {
                font-size: 20px;
            }
            
            /* Tools and filters - improve mobile layout */
            .filters {
                padding: 16px;
            }
            
            .filters-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
                margin-bottom: 16px;
            }
            
            .filters-controls {
                width: 100%;
                justify-content: space-between;
            }
            
            .filters-content {
                flex-direction: column;
                gap: 16px;
                align-items: stretch;
            }
            
            .filter-group {
                min-width: unset;
                width: 100%;
            }
            
            .filter-group select,
            .filter-group input {
                width: 100%;
                box-sizing: border-box;
            }
            
            /* Export CSV button - full width on mobile */
            .filter-group button {
                width: 100%;
                padding: 12px 16px;
                font-size: 16px;
            }
        }
        
        /* Last Updated Timestamp - Gmail-like styling */
        .last-updated-timestamp {
            position: fixed;
            bottom: 8px;
            right: 8px;
            background: rgba(255, 255, 255, 0.9);
            color: #5f6368;
            font-size: 11px;
            font-family: 'Roboto', Arial, sans-serif;
            padding: 4px 8px;
            border-radius: 4px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            z-index: 1000;
            pointer-events: none;
            user-select: none;
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
        }
        
        .last-updated-timestamp span {
            display: inline;
        }
        
        /* Ensure it doesn't interfere with mobile layout */
        @media (max-width: 768px) {
            .last-updated-timestamp {
                bottom: 4px;
                right: 4px;
                font-size: 10px;
                padding: 3px 6px;
            }
        }
        
        /* FAQ Modern Card Styles */
        #faqPage {
            background: #f8f9fa;
        }
        
        .faq-container {
            max-width: 800px !important;
            margin: 60px auto !important;
            padding: 24px !important;
        }
        
        .faq-card {
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            margin-bottom: 16px;
            transition: all 0.3s ease;
            overflow: hidden;
            border: 1px solid rgba(0,0,0,0.06);
        }
        
        .faq-card:hover {
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            transform: translateY(-1px);
        }
        
        .faq-button {
            background: none;
            border: none;
            width: 100%;
            text-align: left;
            padding: 24px;
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            transition: all 0.2s ease;
            outline: none;
        }
        
        .faq-button:hover {
            background: rgba(0,123,255,0.02);
            color: #007bff;
        }
        
        .faq-button:focus {
            background: rgba(0,123,255,0.04);
            color: #007bff;
        }
        
        .faq-question-text {
            flex: 1;
        }
        
        .faq-icon {
            flex-shrink: 0;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: #007bff;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: 700;
            transition: all 0.3s ease;
        }
        
        .faq-answer {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }
        
        .faq-answer-content {
            padding: 0 24px 24px 24px;
            color: #555;
            font-size: 16px;
            line-height: 1.6;
        }
        
        .faq-answer p {
            margin-bottom: 16px;
        }
        
        .faq-answer p:last-child {
            margin-bottom: 0;
        }
        
        .faq-answer ul {
            margin: 16px 0;
            padding-left: 24px;
        }
        
        .faq-answer li {
            margin-bottom: 8px;
            color: #666;
        }
        
        .faq-answer li strong {
            color: #333;
            font-weight: 600;
        }
        
        .faq-answer a {
            color: #007bff;
            text-decoration: none;
            font-weight: 500;
        }
        
        .faq-answer a:hover {
            text-decoration: underline;
        }
        
        .faq-back-button {
            background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,123,255,0.3);
            transition: all 0.2s ease;
        }
        
        .faq-back-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,123,255,0.4);
        }
        
        .faq-back-button:active {
            transform: translateY(0);
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* Mobile FAQ Styles */
        @media (max-width: 768px) {
            .faq-container {
                margin: 20px auto !important;
                padding: 16px !important;
            }
            
            .faq-button {
                padding: 20px;
                font-size: 16px;
                gap: 12px;
            }
            
            .faq-icon {
                width: 24px;
                height: 24px;
                font-size: 14px;
            }
            
            .faq-answer-content {
                padding: 0 20px 20px 20px;
                font-size: 15px;
            }
            
            .faq-back-button {
                width: 100%;
                padding: 16px;
                font-size: 16px;
                margin-top: 20px;
            }
        }
        
        /* Mobile Table Styles */
        @media (max-width: 768px) {
            table {
                font-size: 12px;
            }
            
            th, td {
                padding: 6px 4px;
            }
            
            /* Hide columns on mobile */
            th:nth-child(2), td:nth-child(2) { /* Takeoff time (SA) */
                display: none;
            }
            
            th:nth-child(5), td:nth-child(5) { /* Filename */
                display: none;
            }
            
            th:nth-child(6), td:nth-child(6) { /* KML */
                display: none;
            }
            
            th:nth-child(7), td:nth-child(7) { /* Size */
                display: none;
            }
            
            /* Allow Owner column to wrap on mobile */
            td:nth-child(4) { /* Owner column */
                white-space: normal;
                min-width: unset;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <button onclick="showHome()">Home</button>
        <button onclick="showContact()">Contact</button>
        <button onclick="showFAQ()">FAQ</button>
    </div>

    <div class="main-content">
        <h1 class="main-title">Misbehaving Operators Roaming Over National Sanctuaries</h1>
        
        <!-- Viewing Flight Information Box -->
        <div id="viewingFlightBox" style="display: none; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; margin: 16px 0; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="background: #e9ecef; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #dee2e6;">
                <h3 id="viewingFlightTitle" style="margin: 0; color: #495057; font-size: 1.1rem;">Viewing Flight: </h3>
                <div style="display: flex; gap: 8px;">
                    <button onclick="jumpToTable()" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">📋 Jump to Table</button>
                    <button onclick="closeViewingFlight()" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">✕ Close</button>
                </div>
            </div>
            <div style="padding: 16px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 1px solid #dee2e6;">
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Date</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">SA Time</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Registration</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Owner</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Filename</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">KML</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Size</th>
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">Take action</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td id="viewingFlightDate" style="padding: 8px 12px;">-</td>
                            <td id="viewingFlightSA" style="padding: 8px 12px;">-</td>
                            <td id="viewingFlightReg" style="padding: 8px 12px;">-</td>
                            <td id="viewingFlightOwner" style="padding: 8px 12px;">-</td>
                            <td id="viewingFlightFilename" style="padding: 8px 12px;">-</td>
                            <td style="padding: 8px 12px;">
                                <button id="viewingFlightDownload" onclick="downloadKML('')" style="font-size: 1.3em; color: #007bff; text-decoration: none; cursor: pointer; background: none; border: none; padding: 0;" title="Download KML">⬇️</button>
                            </td>
                            <td id="viewingFlightSize" style="padding: 8px 12px;">-</td>
                            <td style="padding: 8px 12px;">
                                <button onclick="takeAction()" style="background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600;">👮</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <div id="map"></div>
        
        <!-- Summary cards -->
        <div class="summary-cards" id="summaryCards">
            <div class="summary-card">
                <div class="summary-label">FLIGHTS</div>
                <div class="summary-value" id="flightsCount">${flightData.length}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">HELICOPTERS</div>
                <div class="summary-value" id="helicoptersCount">${new Set(flightData.map(f => f.registration)).size}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">DATE START</div>
                <div class="summary-value" id="dateStartCard">${flightData.length > 0 ? flightData.map(f => f.date).sort()[0] : ''}</div>
            </div>
            <div class="summary-card">
                <div class="summary-label">DATE END</div>
                <div class="summary-value" id="dateEndCard">${flightData.length > 0 ? flightData.map(f => f.date).sort().slice(-1)[0] : ''}</div>
            </div>
        </div>
        
        <!-- Update schedule notification -->
        <div class="update-schedule-notification">
            ℹ️ This site is updated on weekends, once per month
        </div>

        <div class="filters-container">
            <div id="filtersCard" class="filters">
                <div class="filters-header">
                    <div class="filters-title">Tools and filters 🔧</div>
                    <div class="filters-controls">
                        <span id="filterSummary" class="filter-summary">All flights</span>
                        <button class="toggle-btn" onclick="toggleFilters()">Show Filters</button>
                        <button class="clear-btn" onclick="clearFilters()" style="display: none;">Clear Filters</button>
                    </div>
                </div>
                <div id="filtersContent" class="filters-content" style="display: none;">
                    <div class="filter-group">
                        <label>Registration:</label>
                        <select id="registrationFilter">
                            <option value="">All Registrations</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Owner:</label>
                        <select id="ownerFilter">
                            <option value="">All Owners</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label>Date from:</label>
                        <input type="date" id="dateStart">
                    </div>
                    <div class="filter-group">
                        <label>Date to:</label>
                        <input type="date" id="dateEnd">
                    </div>
                    <div class="filter-group">
                        <button onclick="exportCSV()">Export CSV</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="tableContainer">
            <h2>Airspace Violations</h2>
            <p style="text-align: center; padding: 20px; color: #6c757d;">Loading flights...</p>
            <!-- Table will be dynamically rendered by JavaScript -->
        </div>
    </div>


    <!-- Report Modal -->
    <div id="reportModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeReportModal()">&times;</span>
            <div id="reportModalContent"></div>
        </div>
    </div>

    <!-- FAQ Page -->
    <div id="faqPage" style="display: none; min-height: 100vh; padding-top: 70px;">
        <div class="faq-container">
            <h1 style="text-align: center; color: #2c3e50; margin-bottom: 40px; font-size: 2.5rem; font-weight: 700;">Frequently Asked Questions</h1>
            <div id="faqContent">
                <!-- FAQ items will be populated by JavaScript -->
            </div>
            <div style="text-align: center; margin-top: 40px;">
                <button onclick="showHome()" class="faq-back-button">
                    ← Back to Home
                </button>
            </div>
        </div>
    </div>

    <!-- Contact Page -->
    <div id="contactPage" style="display: none; min-height: 100vh; padding-top: 70px;">
        <div class="faq-container">
            <h1 style="text-align: center; color: #2c3e50; margin-bottom: 40px; font-size: 2.5rem; font-weight: 700;">Contact</h1>
            <div style="max-width: 800px; margin: 0 auto; padding: 0 20px;">
                <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; margin-bottom: 30px;">
                    <h2 style="color: #2c3e50; margin-bottom: 20px;">Get in Touch</h2>
                    <p style="color: #555; line-height: 1.6; margin-bottom: 20px;">
                        For questions about helicopter tracking data, airspace violations, or technical issues with this site, please contact us.
                    </p>
                    <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff;">
                        <h3 style="color: #2c3e50; margin-bottom: 15px;">Contact Information</h3>
                        <div id="emailContainer" style="margin-bottom: 10px;">
                            <button id="emailButton" onclick="revealEmail()" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; transition: all 0.3s ease;">
                                Click to show email address
                            </button>
                            <div id="emailAddress" style="display: none; opacity: 0; transition: opacity 0.5s ease; color: #555; font-weight: 600;">
                                admin@morons.org.za
                            </div>
                        </div>
                        <p style="color: #666; font-size: 14px;">
                            Please include relevant flight details (registration, date, time) when reporting specific violations or requesting data.
                        </p>
                    </div>
                </div>
            </div>
            <div style="text-align: center; margin-top: 40px;">
                <button onclick="showHome()" class="faq-back-button">
                    ← Back to Home
                </button>
            </div>
        </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet-omnivore@0.3.4/leaflet-omnivore.min.js"></script>
    <script>
        // Check if libraries loaded successfully after a brief delay
        setTimeout(function() {
            if (typeof L === 'undefined') {
                console.error('Leaflet library failed to load');
                window.leafletError = true;
            }
            if (typeof omnivore === 'undefined') {
                console.error('Leaflet Omnivore library failed to load');
                window.omnivoreError = true;
            }
        }, 1000);
    </script>
    <script id="flight-data-script">
        window.buildTimestamp = ${JSON.stringify(buildTimestamp)};
        window.latestFlightDate = ${JSON.stringify(latestFlightDate)};
        window.embeddedFlightData = ${JSON.stringify(flightData)};
        window.embeddedTmnpKml = ${JSON.stringify(tmnpKmlContent)};
    </script>
    <script src="./js/app.js"></script>

    <!-- Last Updated Timestamp -->
    <div id="lastUpdatedTimestamp" class="last-updated-timestamp">
        <span id="siteUpdateTime"></span>
        <span id="flightDataTime"></span>
    </div>

</body>
</html>`;

// Create js directory
const jsDir = path.join(BUILD_DIR, 'js');
fs.mkdirSync(jsDir, { recursive: true });

// Write the HTML file
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), htmlContent);

// Write the JavaScript file
fs.writeFileSync(path.join(jsDir, 'app.js'), appJsContent);
console.log('📄 Generated app.js');

// Copy master-metadata.json to static site for external loading
const metadataPath = path.join(__dirname, 'master-metadata.json');
const staticMetadataPath = path.join(BUILD_DIR, 'master-metadata.json');
if (fs.existsSync(metadataPath)) {
    fs.copyFileSync(metadataPath, staticMetadataPath);
    console.log('📄 Copied master-metadata.json for external loading');
}

console.log('✅ Generated static HTML file');

// Create a README for the static site
const readmeContent = `# TMNP Helicopter Tracking - Static Site

This is a static website generated from the TMNP Helicopter Tracking System.

## 🚀 Features

- **Interactive Map**: View flight paths and TMNP boundary
- **Flight Database**: Browse all ${flightData.length} detected flights
- **Search & Filter**: Find flights by registration, date range
- **Download KML**: Get original flight data files
- **Export CSV**: Export filtered data for analysis
- **Flight Maps**: View generated PNG flight path images

## 📁 Contents

- \`index.html\` - Main website
- \`kml/\` - All KML flight files
- \`flight-maps/\` - Generated PNG flight path images
- \`tmnp.kml\` - Table Mountain National Park boundary

## 🌐 Deployment

This static site is deployed to **GitHub Pages**.

To deploy updates, use the backend admin interface at http://localhost:4000

## 🔧 Local Development

To regenerate this site with updated data:

\`\`\`bash
node build-static-site.cjs
\`\`\`

## 📊 Data Source

Generated from ${flightData.length} flights detected with NP17 airspace violations over Table Mountain National Park.

Last updated: ${new Date().toISOString()}
`;

fs.writeFileSync(path.join(BUILD_DIR, 'README.md'), readmeContent);

console.log('✅ Generated README file');

// Final summary
console.log('\n🎉 Static Site Build Complete!');
console.log('📁 Build directory:', BUILD_DIR);
console.log('📊 Total flights:', flightData.length);
console.log('📄 Files generated:');
console.log('   • index.html (main website)');
console.log('   • README.md (deployment guide)');
console.log(`   • kml-optimised/ (${fs.readdirSync(path.join(BUILD_DIR, 'kml-optimised')).length} optimized KML files)`);
console.log('   • tmnp.kml (boundary file)');
console.log('   • PNG flight maps served from GitHub media URLs');

console.log('\n🚀 Next Steps:');
console.log('1. Test the site locally: ./launch.sh (opens http://localhost:8080)');
console.log('2. Deploy to GitHub Pages using the backend admin interface');
console.log('3. Share the URL with users who need to view the data');
