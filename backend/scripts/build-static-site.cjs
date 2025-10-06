#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building Static Site for TMNP Helicopter Tracking...\n');

// Configuration
const BUILD_DIR = 'static-site';
const SOURCE_DIRS = {
  uploads: 'uploads',
  flightMaps: 'flight-maps',
  tmnpBoundaryPrimary: '../static-site/tmnp.kml',
  tmnpBoundaryFallback: 'static-site/tmnp.kml'
};

// Prepare build directory (preserve optimized KMLs)
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}
console.log('🧹 Cleaning build subdirectories (preserving kml-optimised)...');
// Remove generated subdirs but keep kml-optimised
const KML_DIR = path.join(BUILD_DIR, 'kml');
const FLIGHT_MAPS_DIR = path.join(BUILD_DIR, 'flight-maps');
if (fs.existsSync(KML_DIR)) fs.rmSync(KML_DIR, { recursive: true });
if (fs.existsSync(FLIGHT_MAPS_DIR)) fs.rmSync(FLIGHT_MAPS_DIR, { recursive: true });

// Create subdirectories
fs.mkdirSync(KML_DIR, { recursive: true });
fs.mkdirSync(FLIGHT_MAPS_DIR, { recursive: true });
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
  }
  console.log('✅ TMNP boundary available');
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

// Copy optimized KML files (prefer optimized versions over original)
const optimizedDir = path.join(BUILD_DIR, 'kml-optimised');
let copiedCount = 0;
let skippedCount = 0;

if (fs.existsSync(SOURCE_DIRS.uploads)) {
  const kmlFiles = fs.readdirSync(SOURCE_DIRS.uploads).filter(f => f.endsWith('.kml'));
  console.log(`📁 Processing ${kmlFiles.length} KML files...`);
  
  kmlFiles.forEach(file => {
    const baseName = file.replace('.kml', '');
    const optimizedFile = `${baseName}-opt.kml`;
    const optimizedSourcePath = path.join(optimizedDir, optimizedFile);
    const originalSourcePath = path.join(SOURCE_DIRS.uploads, file);
    const destPath = path.join(BUILD_DIR, 'kml', file);
    
    // Prefer optimized version if it exists
    if (fs.existsSync(optimizedSourcePath)) {
      fs.copyFileSync(optimizedSourcePath, destPath);
      copiedCount++;
    } else {
      // Fall back to original file
      fs.copyFileSync(originalSourcePath, destPath);
      skippedCount++;
      console.log(`⚠️  No optimized version for ${file}, using original`);
    }
  });
  console.log(`✅ Copied ${copiedCount} optimized KML files, ${skippedCount} original files`);
} else {
  console.log('⚠️  Uploads directory not found');
}

// PNG files are now served from GitHub LFS - no need to copy locally
console.log('📸 PNG files will be served from GitHub LFS');

// Load TMNP boundary KML content for direct embedding
console.log('\n📄 Loading TMNP boundary KML...');
let tmnpKmlContent = '';
try {
  if (fs.existsSync('../static-site/tmnp.kml')) {
    tmnpKmlContent = fs.readFileSync('../static-site/tmnp.kml', 'utf8');
  } else if (fs.existsSync(path.join(BUILD_DIR, 'tmnp.kml'))) {
    tmnpKmlContent = fs.readFileSync(path.join(BUILD_DIR, 'tmnp.kml'), 'utf8');
  }
  if (tmnpKmlContent) {
    console.log('✅ Loaded TMNP boundary KML content');
  } else {
    console.log('⚠️  TMNP boundary KML not found, map will work without boundary overlay');
  }
} catch (error) {
  console.log('⚠️  TMNP boundary KML not found, map will work without boundary overlay');
}

// Load flight metadata
console.log('\n📊 Loading flight metadata...');
let flightData = [];

try {
  // Try to load from master metadata first
  if (fs.existsSync('server/master-metadata.json')) {
    const masterMetadata = JSON.parse(fs.readFileSync('server/master-metadata.json', 'utf8'));
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
  } else if (fs.existsSync('server/kml-metadata-cache.json')) {
    const cacheMetadata = JSON.parse(fs.readFileSync('server/kml-metadata-cache.json', 'utf8'));
    console.log('✅ Loaded cache metadata');
    
    // Convert to flat array format
    flightData = Object.values(cacheMetadata).filter(flight => 
      flight && flight.filename && flight.registration
    );
  } else {
    console.log('⚠️  No metadata files found, scanning KML files directly...');
    
    // Fallback: scan KML files directly
    const kmlFiles = fs.readdirSync(SOURCE_DIRS.uploads).filter(f => f.endsWith('.kml'));
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

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TMNP Helicopter Tracking - Airspace Violations</title>
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
            max-width: 800px;
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
            gap: 24px;
            margin-top: 8px;
            align-items: center;
            justify-content: flex-start;
        }
        
        .filter-group {
            position: relative;
            min-width: 180px;
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
            
            .filters {
                flex-direction: column;
                align-items: stretch;
            }
            
            .filters input, .filters button {
                margin: 4px 0;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <button onclick="showHome()">Home</button>
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
                            <th style="padding: 8px 12px; text-align: left; font-weight: 600; color: #495057;">UTC Time</th>
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
                            <td id="viewingFlightUTC" style="padding: 8px 12px;">-</td>
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
                        <input type="text" id="registrationFilter" placeholder="Type registration...">
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
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>UTC Time</th>
                        <th>SA Time</th>
                        <th>Registration</th>
                        <th>Owner</th>
                        <th>Filename</th>
                        <th>KML</th>
                        <th>Size</th>
                        <th>View Flight</th>
                        <th>Take action</th>
                    </tr>
                </thead>
                <tbody>
                    ${flightData.sort((a, b) => new Date(b.date) - new Date(a.date)).map(flight => `
                        <tr class="flight-row">
                            <td>${flight.date || '-'}</td>
                            <td>${flight.time || '-'}</td>
                            <td>${utcToSaTime(flight.date, flight.time)}</td>
                            <td>${flight.registration || '-'}</td>
                            <td>${flight.owner || '-'}</td>
                            <td>${flight.filename || '-'}</td>
                            <td style="text-align: center;">
                                <a href="https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/${flight.filename}" download="${flight.filename}" title="Download KML" style="font-size: 1.3em; color: #007bff; text-decoration: none; cursor: pointer;" onclick="event.stopPropagation(); downloadKML('${flight.filename}'); return false;">⬇️</a>
                            </td>
                            <td style="text-align: center;">${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-'}</td>
                            <td>
                                <button onclick="event.stopPropagation(); loadFlightOnMap('${flight.filename}')" style="padding: 4px 12px; border-radius: 4px; background: #007bff; color: #fff; border: none; cursor: pointer; font-size: 1.2em;" title="View on map">👀</button>
                            </td>
                            <td>
                                <button onclick="event.stopPropagation(); reportFlight('${flight.filename}')" style="padding: 6px 12px; border-radius: 4px; background: #dc3545; color: #fff; border: none; cursor: pointer; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 4px;" title="Generate violation report">👮‍♂️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
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
    <div id="faqPage" style="display: none; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; padding-top: 70px;">
        <div style="max-width: 700px; margin: 60px auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); padding: 32px;">
            <h1 style="text-align: center;">FAQ</h1>
            <div id="faqContent">
                <!-- FAQ items will be populated by JavaScript -->
            </div>
        </div>
        <div style="text-align: center; margin-top: 24px;">
            <button onclick="showHome()" style="padding: 8px 24px; border-radius: 6px; background: #007bff; color: #fff; border: none; font-weight: 600; font-size: 16px; cursor: pointer;">
                Back
            </button>
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
        window.embeddedFlightData = ${JSON.stringify(JSON.stringify(flightData))};
    </script>
    <script id="tmnp-kml-script">
        window.embeddedTmnpKml = ${JSON.stringify(tmnpKmlContent)};
    </script>
    <script>
        // Flight data embedded from build process
        const flightData = JSON.parse(window.embeddedFlightData);
        
        // Global variables
        let map;
        let currentFlightLayer = null;
        let filteredData = [...flightData];
        let showFilters = false;
        let lastViewedFilename = null;
        
        // UTC to South Africa time conversion
        function utcToSaTime(date, time) {
            if (!date || !time) return '-';
            // date: '2025-05-03', time: '07:31'
            const utc = new Date(\`\${date}T\${time}:00Z\`);
            // South Africa is UTC+2
            const sa = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
            return sa.toISOString().slice(11, 16); // 'HH:MM'
        }
        
        // Toggle filters visibility
        function toggleFilters() {
            showFilters = !showFilters;
            const content = document.getElementById('filtersContent');
            const button = document.querySelector('.toggle-btn');
            const clearBtn = document.querySelector('.clear-btn');
            const filtersCard = document.getElementById('filtersCard');
            
            if (showFilters) {
                content.style.display = 'flex';
                button.textContent = 'Hide Filters';
                filtersCard.classList.remove('collapsed');
            } else {
                content.style.display = 'none';
                button.textContent = 'Show Filters';
                filtersCard.classList.add('collapsed');
            }
            
            // Show/hide clear button based on active filters
            const hasFilters = document.getElementById('registrationFilter').value || 
                              document.getElementById('dateStart').value || 
                              document.getElementById('dateEnd').value;
            clearBtn.style.display = hasFilters ? 'block' : 'none';
        }
        
        // Wait for libraries to load, then initialize
        function waitForLibraries() {
            if (typeof L !== 'undefined' && typeof omnivore !== 'undefined') {
                console.log('✅ Libraries loaded successfully');
                initializeMap();
                setupEventListeners();
                updateSummary();
            } else if (window.leafletError || window.omnivoreError) {
                console.error('❌ Libraries failed to load');
                showConnectionError();
                setupEventListeners(); // Still allow table functionality
                updateSummary();
            } else {
                console.log('⏳ Waiting for libraries to load...');
                setTimeout(waitForLibraries, 100);
            }
        }
        
        // Initialize the application when DOM is ready
        document.addEventListener('DOMContentLoaded', waitForLibraries);
        
        function showConnectionError() {
            const mapContainer = document.getElementById('map');
            mapContainer.innerHTML = \`
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #f8f9fa; border-radius: 8px; padding: 40px; text-align: center;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🌐</div>
                    <h3 style="color: #dc3545; margin-bottom: 12px;">Internet Connection Required</h3>
                    <p style="color: #6c757d; margin-bottom: 16px; max-width: 400px;">
                        The interactive map requires an internet connection to load mapping libraries. 
                        Please check your connection and refresh the page.
                    </p>
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 16px; margin-top: 16px; max-width: 400px;">
                        <strong>Note:</strong> You can still view all flight data in the table below, 
                        download KML files, and generate violation reports without the map.
                    </div>
                    <button onclick="location.reload()" style="margin-top: 16px; padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        🔄 Retry
                    </button>
                </div>
            \`;
        }
        
        function initializeMap() {
            console.log('🗺️ Initializing map...');
            console.log('Leaflet available:', typeof L);
            console.log('Omnivore available:', typeof omnivore);
            console.log('Map container exists:', document.getElementById('map'));
            
            if (typeof L === 'undefined') {
                console.error('❌ Leaflet not available, showing connection error');
                showConnectionError();
                return;
            }
            
            if (typeof omnivore === 'undefined') {
                console.error('❌ Omnivore not available, showing connection error');
                showConnectionError();
                return;
            }
            
            // Initialize map centered on Cape Town
            map = L.map('map').setView([-33.9249, 18.4241], 10);
            console.log('Map created:', map);
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            console.log('Tile layer added to map');
            
            // Add TMNP boundary from embedded KML content (works with file:// protocol)
            console.log('Loading TMNP boundary from embedded data...');
            
            if (window.embeddedTmnpKml) {
                // Parse the embedded KML and create layers directly
                const parser = new DOMParser();
                const kmlDoc = parser.parseFromString(window.embeddedTmnpKml, 'text/xml');
                
                // Create a layer group for the TMNP boundary
                const tmnpLayerGroup = L.layerGroup().addTo(map);
                
                // Parse KML features and add to map
                const polygons = kmlDoc.querySelectorAll('Polygon');
                let bounds = null;
                
                polygons.forEach(polygon => {
                    const outerBoundary = polygon.querySelector('outerBoundaryIs LinearRing coordinates');
                    if (outerBoundary) {
                        const coordsText = outerBoundary.textContent.trim();
                        const coords = coordsText.split(/\\s+/).map(coord => {
                            const [lon, lat] = coord.split(',').map(parseFloat);
                            return [lat, lon];
                        }).filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
                        
                        if (coords.length > 0) {
                            const poly = L.polygon(coords, {
                                color: '#ff0000',
                                weight: 3,
                                opacity: 0.7,
                                fillColor: '#ff0000',
                                fillOpacity: 0.25
                            });
                            tmnpLayerGroup.addLayer(poly);
                            
                            // Calculate bounds for the whole park
                            const polyBounds = L.latLngBounds(coords);
                            if (!bounds) {
                                bounds = polyBounds;
                            } else {
                                bounds.extend(polyBounds);
                            }
                        }
                    }
                });
                
                if (bounds) {
                    console.log('TMNP boundary loaded successfully from embedded data');
                    map.fitBounds(bounds, { padding: [20, 20] });
                } else {
                    console.log('No valid polygon data found in TMNP KML');
                }
            } else {
                console.log('No embedded TMNP KML data found');
            }
            
            // Show initial instruction overlay
            const instructionDiv = document.createElement('div');
            instructionDiv.id = 'instructionOverlay';
            instructionDiv.innerHTML = '<div style="text-align: center; line-height: 1.4;"><div style="font-size: 18px; margin-bottom: 8px;">🗺️ Flight Tracking Map</div><div style="font-size: 14px; margin-bottom: 12px;">Scroll down to view flights</div><div style="font-size: 12px; color: #ccc;">Click the 👀 button on any flight to see its path</div></div>';
            instructionDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 25px 35px; border-radius: 12px; z-index: 1000; font-size: 14px; font-weight: 500; box-shadow: 0 6px 20px rgba(0,0,0,0.4); max-width: 300px;';
            map.getContainer().appendChild(instructionDiv);
            
            // Auto-hide instruction after 8 seconds
            setTimeout(() => {
                if (instructionDiv.parentNode) {
                    instructionDiv.parentNode.removeChild(instructionDiv);
                }
            }, 8000);
        }
        
        function setupEventListeners() {
            // Set initial date range
            if (flightData.length > 0) {
                const dates = flightData.map(f => f.date).sort();
                document.getElementById('dateStart').value = dates[0];
                document.getElementById('dateEnd').value = dates[dates.length - 1];
            }
            
            // Filter input events
            document.getElementById('registrationFilter').addEventListener('input', applyFilters);
            document.getElementById('dateStart').addEventListener('change', applyFilters);
            document.getElementById('dateEnd').addEventListener('change', applyFilters);
            
            // Update clear button visibility on input
            ['registrationFilter', 'dateStart', 'dateEnd'].forEach(id => {
                document.getElementById(id).addEventListener('input', () => {
                    const hasFilters = document.getElementById('registrationFilter').value || 
                                      document.getElementById('dateStart').value || 
                                      document.getElementById('dateEnd').value;
                    document.querySelector('.clear-btn').style.display = hasFilters ? 'block' : 'none';
                });
            });
        }
        
        function applyFilters() {
            const registration = document.getElementById('registrationFilter').value.toLowerCase();
            const dateStart = document.getElementById('dateStart').value;
            const dateEnd = document.getElementById('dateEnd').value;
            
            filteredData = flightData.filter(flight => {
                const regMatch = !registration || flight.registration.toLowerCase().includes(registration);
                const dateMatch = (!dateStart || flight.date >= dateStart) && (!dateEnd || flight.date <= dateEnd);
                return regMatch && dateMatch;
            });
            
            renderTable();
            updateSummary();
        }
        
        function clearFilters() {
            document.getElementById('registrationFilter').value = '';
            document.getElementById('dateStart').value = '';
            document.getElementById('dateEnd').value = '';
            filteredData = [...flightData];
            renderTable();
            updateSummary();
            
            // Hide clear button
            document.querySelector('.clear-btn').style.display = 'none';
            // Update filter summary
            document.getElementById('filterSummary').textContent = 'All flights';
        }
        
        function updateSummary() {
            const uniqueHelicopters = new Set(filteredData.map(f => f.registration)).size;
            const dates = filteredData.map(f => f.date).sort();
            const startDate = dates.length > 0 ? dates[0] : '';
            const endDate = dates.length > 0 ? dates[dates.length - 1] : '';
            
            // Update summary cards
            const flightsEl = document.getElementById('flightsCount');
            const helisEl = document.getElementById('helicoptersCount');
            const startEl = document.getElementById('dateStartCard');
            const endEl = document.getElementById('dateEndCard');
            if (flightsEl) flightsEl.textContent = filteredData.length;
            if (helisEl) helisEl.textContent = uniqueHelicopters;
            if (startEl) startEl.textContent = startDate || '-';
            if (endEl) endEl.textContent = endDate || '-';
            
            // Update filter summary
            const filterSummary = document.getElementById('filterSummary');
            if (filteredData.length === flightData.length) {
                filterSummary.textContent = 'All flights';
            } else {
                filterSummary.textContent = filteredData.length + ' of ' + flightData.length + ' flights';
            }
            
            // Show/hide clear button
            const hasFilters = document.getElementById('registrationFilter').value || 
                              document.getElementById('dateStart').value || 
                              document.getElementById('dateEnd').value;
            document.querySelector('.clear-btn').style.display = hasFilters ? 'block' : 'none';
        }
        
        function renderTable() {
            const container = document.getElementById('tableContainer');
            
            if (filteredData.length === 0) {
                container.innerHTML = '<div class="error">No flights found matching the current filters.</div>';
                return;
            }
            
            // Sort by date (newest first)
            const sortedData = [...filteredData].sort((a, b) => new Date(b.date) - new Date(a.date));
            
            const tableHTML = \`
                <h2>Airspace Violations</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>UTC Time</th>
                            <th>SA Time</th>
                            <th>Registration</th>
                            <th>Owner</th>
                            <th>Filename</th>
                            <th>KML</th>
                            <th>Size</th>
                            <th>View Flight</th>
                            <th>Take action</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${sortedData.map(flight => \`
                            <tr id="flight-\${flight.filename}" class="flight-row" onclick="viewFlight('\${flight.filename}')" style="\${lastViewedFilename === flight.filename ? 'background: #e6f7ff;' : ''}">
                                <td>\${flight.date || '-'}</td>
                                <td>\${flight.time || '-'}</td>
                                <td>\${utcToSaTime(flight.date, flight.time)}</td>
                                <td>\${flight.registration || '-'}</td>
                                <td>\${flight.owner || '-'}</td>
                                <td>\${flight.filename || '-'}</td>
                                <td style="text-align: center;">
                                    <a href="https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/\${flight.filename}" download="\${flight.filename}" title="Download KML" style="font-size: 1.3em; color: #007bff; text-decoration: none; cursor: pointer;" onclick="event.stopPropagation(); downloadKML('\${flight.filename}'); return false;">⬇️</a>
                                </td>
                                <td style="text-align: center;">\${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-'}</td>
                                <td>
                                    <button onclick="event.stopPropagation(); loadFlightOnMap('\${flight.filename}')" style="padding: 4px 12px; border-radius: 4px; background: #007bff; color: #fff; border: none; cursor: pointer; font-size: 1.2em;" title="View on map">👀</button>
                                </td>
                                <td>
                                    <button onclick="event.stopPropagation(); reportFlight('\${flight.filename}')" style="padding: 6px 12px; border-radius: 4px; background: #dc3545; color: #fff; border: none; cursor: pointer; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 4px;" title="Generate violation report">👮‍♂️</button>
                                </td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
            
            container.innerHTML = tableHTML;
            updateSummary();
        }
        
        
        function loadFlightOnMap(filename) {
            const startTime = performance.now();
            const flight = flightData.find(f => f.filename === filename);
            if (!flight) return;
            
            console.log('🚀 Starting flight load for:', filename);
            console.log('📊 File size:', flight.fileSizeMB, 'MB');
            
            // Set the last viewed filename for highlighting
            lastViewedFilename = filename;
            
            // Show and populate the viewing flight information box
            showViewingFlight(flight);
            
            // Scroll to top to show the map update
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // Re-render table to show highlighting
            renderTable();
            
            // Remove previous flight layer
            if (currentFlightLayer) {
                map.removeLayer(currentFlightLayer);
            }
            
            // Remove instruction overlay if it exists
            const instructionOverlay = document.getElementById('instructionOverlay');
            if (instructionOverlay) {
                instructionOverlay.remove();
            }
            
             // Show loading indicator in center of map
             const loadingDiv = document.createElement('div');
             loadingDiv.innerHTML = '<span class="helicopter-loader">🚁</span> Loading flight path...';
             loadingDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 30px; border-radius: 10px; z-index: 1000; font-size: 16px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
             map.getContainer().appendChild(loadingDiv);
            
            // Try local KML first, fallback to GitHub
            const localUrl = './kml/' + filename;
            const githubUrl = 'https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/' + filename;
            
            console.log('📍 Checking local KML first:', localUrl);
            
            const downloadStartTime = performance.now();
            
            // Try to load from local copy first (much faster if available)
            currentFlightLayer = omnivore.kml(localUrl)
                .on('ready', function() {
                    const downloadTime = performance.now() - downloadStartTime;
                    const totalTime = performance.now() - startTime;
                    
                    console.log('✅ Local KML loaded successfully!');
                    console.log('⚡ Performance:', {
                        downloadTime: (downloadTime / 1000).toFixed(2) + 's',
                        totalTime: (totalTime / 1000).toFixed(2) + 's',
                        fileSize: flight.fileSizeMB + 'MB',
                        speed: (flight.fileSizeMB / (downloadTime / 1000)).toFixed(2) + 'MB/s'
                    });
                    
                    // Remove loading indicator
                    if (loadingDiv.parentNode) {
                        loadingDiv.parentNode.removeChild(loadingDiv);
                    }
                    
                    this.setStyle(() => ({
                        color: '#0000ff',
                        weight: 4,
                        opacity: 0.8
                    }));
                    
                    // Fit bounds to both TMNP and the new KML if both are present
                    if (tmnpLayer) {
                        const group = L.featureGroup([tmnpLayer, this]);
                        map.fitBounds(group.getBounds(), { padding: [20, 20] });
                    } else {
                        map.fitBounds(this.getBounds(), { padding: [20, 20] });
                    }
                })
                .on('error', function(error) {
                    console.log('⚠️ Local KML failed, trying GitHub URL...');
                    console.log('❌ Local error:', error);
                    
                    // Fallback to GitHub URL
                    const githubStartTime = performance.now();
                    
                    omnivore.kml(githubUrl)
                        .on('ready', function() {
                            const githubDownloadTime = performance.now() - githubStartTime;
                            const totalTime = performance.now() - startTime;
                            
                            console.log('✅ GitHub KML loaded successfully!');
                            console.log('⚡ Performance:', {
                                githubDownloadTime: (githubDownloadTime / 1000).toFixed(2) + 's',
                                totalTime: (totalTime / 1000).toFixed(2) + 's',
                                fileSize: flight.fileSizeMB + 'MB',
                                githubSpeed: (flight.fileSizeMB / (githubDownloadTime / 1000)).toFixed(2) + 'MB/s'
                            });
                            
                            // Remove loading indicator
                            if (loadingDiv.parentNode) {
                                loadingDiv.parentNode.removeChild(loadingDiv);
                            }
                            
                            currentFlightLayer = this;
                            
                            this.setStyle(() => ({
                                color: '#0000ff',
                                weight: 4,
                                opacity: 0.8
                            }));
                            
                            // Fit bounds to both TMNP and the new KML if both are present
                            if (tmnpLayer) {
                                const group = L.featureGroup([tmnpLayer, this]);
                                map.fitBounds(group.getBounds(), { padding: [20, 20] });
                            } else {
                                map.fitBounds(this.getBounds(), { padding: [20, 20] });
                            }
                        })
                        .on('error', function(githubError) {
                            const totalTime = performance.now() - startTime;
                            console.error('❌ Both local and GitHub KML load failed:', {
                                localError: error,
                                githubError: githubError,
                                totalTime: (totalTime / 1000).toFixed(2) + 's'
                            });
                            
                            if (loadingDiv.parentNode) {
                                loadingDiv.parentNode.removeChild(loadingDiv);
                            }
                            
                            // Show error message in map
                            const errorDiv = document.createElement('div');
                            errorDiv.innerHTML = '<div style="text-align: center; color: #dc3545; padding: 20px; font-size: 14px;"><strong>⚠️ Unable to load flight path</strong><br>Both local and GitHub sources failed.<br>Total time: ' + (totalTime / 1000).toFixed(2) + 's</div>';
                            errorDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(255,255,255,0.9); border-radius: 8px; z-index: 1000;';
                            map.getContainer().appendChild(errorDiv);
                            setTimeout(() => {
                                if (errorDiv.parentNode) {
                                    errorDiv.parentNode.removeChild(errorDiv);
                                }
                            }, 5000);
                        })
                        .addTo(map);
                })
                .addTo(map);
            
            closeModal();
        }
        
        function reportFlight(filename) {
            const modal = document.getElementById('reportModal');
            const content = document.getElementById('reportModalContent');
            
            // Find the flight by filename
            const flight = flightData.find(f => f.filename === filename);
            if (!flight) {
                console.error('Flight not found for filename:', filename);
                return;
            }
            
            const registration = flight.registration || 'UNKNOWN';
            const owner = flight.owner || 'Private owner';
            const date = flight.date || 'UNKNOWN DATE';
            const imageFilename = flight.filename ? flight.filename.replace('.kml', '.png') : null;
            const imagePath = imageFilename ? 'https://media.githubusercontent.com/media/werneravr/heli-map/main/server/flight-maps/' + imageFilename : null;
            
            const reportText = 'It appears that a helicopter, registration ' + registration + ' (' + owner + '), entered restricted NP17 airspace over Table Mountain on ' + date + '.\\n\\nThe National Environmental Management Protected Areas Act (NEMPAA NP17) clearly states that aircraft are prohibited from flying over TMNP at any height below 6070FT (~1850m). Doing so without authorisation is an offense with fines up to R5 million or imprisonment for up to 10 years, and can result in the suspension of licenses by the Civil Aviation Authority.\\n\\nNEMPAA (NP17) and these penalties are in place to protect the park\\'s natural environment and ensure compliance with airspace regulations.';
            
            content.innerHTML = \`
                <div style="margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 16px;">
                    <h2 style="margin: 0; color: #333;">Flight Violation Report</h2>
                </div>

                <!-- Flight Map Image -->
                <div style="margin-bottom: 24px; text-align: center;">
                    \${imagePath ? \`
                        <div style="position: relative; display: inline-block;">
                            <img
                                src="\${imagePath}"
                                alt="Flight map for \${registration}"
                                style="width: 320px; height: 320px; object-fit: contain; border-radius: 8px; border: 1px solid #ddd;"
                                onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
                            />
                            <div style="display: none; color: #666; font-style: italic;">Flight map image not available</div>
                            <button
                                onclick="downloadPNG('\${imageFilename}')"
                                style="position: absolute; bottom: 8px; right: 8px; padding: 6px 12px; background-color: rgba(40, 167, 69, 0.9); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; backdrop-filter: blur(4px); box-shadow: 0 2px 4px rgba(0,0,0,0.3);"
                                title="Save flight map image"
                            >
                                💾 Save Image
                            </button>
                        </div>
                    \` : \`
                        <div style="color: #666; font-style: italic; padding: 40px;">Flight map image not available</div>
                    \`}
                </div>

                <!-- Report Information -->
                <div style="margin-bottom: 24px;">
                    <!-- Report Text -->
                    <div style="background-color: #f8f9fa; padding: 16px; border-radius: 8px; border: 1px solid #dee2e6; margin-bottom: 16px; font-family: monospace; font-size: 14px; line-height: 1.5; text-align: left; position: relative;">
                        \${reportText}
                        <button
                            onclick="copyReportText('\${reportText}')"
                            style="position: absolute; bottom: 8px; right: 8px; padding: 4px 8px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;"
                            title="Copy report text to clipboard"
                        >
                            📋 Copy text
                        </button>
                    </div>

                    <!-- Reporting Information -->
                    <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
                        <h3 style="margin: 0 0 12px 0; color: #856404; font-size: 16px;">📧 How to Report This Violation</h3>
                        
                        <div style="margin-bottom: 12px;">
                            <strong style="color: #856404;">South African Civil Aviation Authority (SACAA):</strong><br/>
                            <span style="font-family: monospace; font-size: 13px;">enforcement@caa.co.za</span>
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <strong style="color: #856404;">South African National Parks (SanParks):</strong><br/>
                            <span style="font-family: monospace; font-size: 13px;">TableM@sanparks.org</span>
                        </div>
                        
                        <div style="margin-bottom: 12px;">
                            <strong style="color: #856404;">Helicopter Company Contact:</strong><br/>
                            <span style="font-size: 13px; white-space: pre-line;">\${flight.contact || owner || 'Contact information not available'}</span>
                        </div>
                    </div>

                    <!-- Download Instructions -->
                    <div style="background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 16px;">
                        <h3 style="margin: 0 0 12px 0; color: #0c5460; font-size: 16px;">📁 Evidence Files</h3>
                        
                        <div style="margin-bottom: 8px;">
                            <strong style="color: #0c5460;">KML Flight Data:</strong><br/>
                            <span style="font-size: 13px;">Click the "⬇️ Download KML" button below to download the flight path data</span>
                        </div>
                        
                        <div style="margin-bottom: 8px;">
                            <strong style="color: #0c5460;">PNG Flight Map:</strong><br/>
                            <span style="font-size: 13px;">Click the "💾 Save Image" button on the map above to download the visual evidence</span>
                        </div>
                        
                        <div style="font-size: 12px; color: #0c5460; font-style: italic; margin-top: 8px;">
                            Include both files when reporting to authorities for complete evidence.
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div style="text-align: center; padding-top: 16px; border-top: 1px solid #eee;">
                    <button onclick="downloadKML('\${flight.filename}')" style="padding: 8px 16px; background-color: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; margin-right: 8px;">
                        ⬇️ Download KML
                    </button>
                    <button onclick="closeReportModal()" style="padding: 10px 24px; background-color: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: 600;">
                        Close
                    </button>
                </div>
            \`;
            
            modal.style.display = 'block';
        }
        
        function closeReportModal() {
            document.getElementById('reportModal').style.display = 'none';
        }
        
        function copyReportText(text) {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('Report text copied to clipboard!');
                }).catch(() => {
                    alert('Report text:\\n\\n"' + text + '"\\n\\n(Please copy manually)');
                });
            } else {
                alert('Report text:\\n\\n"' + text + '"\\n\\n(Please copy manually)');
            }
        }
        
        function downloadPNG(filename) {
            const url = 'https://media.githubusercontent.com/media/werneravr/heli-map/main/server/flight-maps/' + filename;
            
            try {
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '⬇️ Downloading...';
                button.disabled = true;
                
                fetch(url)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('HTTP error! status: ' + response.status);
                        }
                        return response.blob();
                    })
                    .then(blob => {
                        const blobUrl = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = filename;
                        link.click();
                        URL.revokeObjectURL(blobUrl);
                        
                        button.innerHTML = '✅ Downloaded!';
                        setTimeout(() => {
                            button.innerHTML = originalText;
                            button.disabled = false;
                        }, 2000);
                    })
                    .catch(error => {
                        console.error('Download error:', error);
                        alert('Failed to download image. Please try again.');
                        button.innerHTML = '💾 Save Image';
                        button.disabled = false;
                    });
            } catch (error) {
                console.error('Download error:', error);
                alert('Failed to download image. Please try again.');
            }
        }
        
        function exportCSV() {
            const headers = ['Date', 'Time', 'Registration', 'Owner', 'Filename', 'Size (MB)'];
            const csvContent = [
                headers.join(','),
                ...filteredData.map(flight => [
                    flight.date || '',
                    flight.time || '',
                    flight.registration || '',
                    flight.owner || '',
                    flight.filename || '',
                    flight.fileSizeMB || ''
                ].join(','))
            ].join('\\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tmnp-flights-' + new Date().toISOString().split('T')[0] + '.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        }
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const reportModal = document.getElementById('reportModal');
            if (event.target === reportModal) {
                closeReportModal();
            }
        }
        
        // KML download function
        async function downloadKML(filename) {
            const url = 'https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/' + filename;
            
            try {
                // Show loading indicator
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '⏳ Downloading...';
                button.disabled = true;
                
                // Fetch the file content
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error('HTTP error! status: ' + response.status);
                }
                
                const blob = await response.blob();
                
                // Create download link
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = filename;
                link.style.display = 'none';
                
                // Trigger download
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Clean up
                window.URL.revokeObjectURL(downloadUrl);
                
                // Restore button
                button.innerHTML = originalText;
                button.disabled = false;
                
                // Show success message
                const successText = button.innerHTML;
                button.innerHTML = '✅ Downloaded!';
                setTimeout(() => {
                    button.innerHTML = successText;
                }, 2000);
                
            } catch (error) {
                console.error('Download failed:', error);
                
                // Restore button
                const button = event.target;
                button.innerHTML = '⬇️';
                button.disabled = false;
                
                // Fallback: open in new tab
                window.open(url, '_blank');
                
                alert('Download failed. Opening file in new tab instead.');
            }
        }
        
        // Home and FAQ functions
        function showHome() {
            // Hide FAQ page and show main content
            document.getElementById('faqPage').style.display = 'none';
            document.querySelector('.main-content').style.display = 'block';
        }
        
        function showFAQ() {
            // Hide main content and show FAQ page
            document.querySelector('.main-content').style.display = 'none';
            document.getElementById('faqPage').style.display = 'flex';
            
            // Populate FAQ content
            populateFAQ();
        }
        
        function populateFAQ() {
            const faqContent = document.getElementById('faqContent');
            const faqs = [
                {
                    question: 'Why does this page exist?',
                    answer: '<div><p>This page was created to help protect the natural tranquillity of Table Mountain National Park (TMNP). Helicopter flights can disturb wildlife, hikers, and the serenity of this unique environment.</p><p>Our goal is to:</p><ul><li>Monitor and highlight helicopter activity over the park, especially those entering airspace where they should not be.</li><li>Inform the public about the extent of unauthorised or disruptive flights.</li><li>Encourage accountability and compliance with airspace regulations.</li></ul><p>In short: This is not about naming and shaming pilots or operators – it is about preserving the peace of our park for everyone who loves it, from hikers to wildlife.</p></div>'
                },
                {
                    question: 'What does the law say?',
                    answer: '<div><p>The law is very clear. Aircraft need permission to fly over Table Mountain National Park (TMNP). If they fly there without permission, there are severe penalties.</p><p>See the National Environmental Management: Protected Areas Act (NEMPAA NP17), which clearly state that aircraft are prohibited from flying over TMNP at any height below 6070FT (~1850m).</p><ul><li><a href="./NEMPAA.pdf" target="_blank" rel="noopener noreferrer" download>NEMPAA (PDF)</a></li><li><a href="./NP17.pdf" target="_blank" rel="noopener noreferrer" download>TMNP boundary NP17 (PDF)</a></li></ul></div>'
                },
                {
                    question: 'What are the penalties?',
                    answer: '<div><p>Violations of the NEMPAA NP17 regulations can result in:</p><ul><li><strong>Fines:</strong> Up to R5 million or imprisonment for up to 10 years</li><li><strong>License suspension:</strong> Civil Aviation Authority can suspend pilot licenses</li><li><strong>Operator penalties:</strong> Helicopter operators can face additional sanctions</li><li><strong>Environmental impact:</strong> Disturbance to wildlife and park visitors</li></ul><p>These penalties are designed to protect the park natural environment and ensure compliance with airspace regulations.</p></div>'
                },
                {
                    question: 'How is this data collected?',
                    answer: '<div><p>Flight data is collected through:</p><ul><li><strong>ADS-B tracking:</strong> Automatic Dependent Surveillance-Broadcast signals from aircraft</li><li><strong>Flight tracking systems:</strong> Publicly available flight tracking data</li><li><strong>Manual verification:</strong> Cross-referencing with official flight plans and permissions</li><li><strong>Geographic analysis:</strong> Determining if flights entered restricted airspace</li></ul><p>All data is publicly available and collected through legitimate means. No private or confidential information is accessed.</p></div>'
                },
                {
                    question: 'What should I do if I see a violation?',
                    answer: '<div><p>If you witness a helicopter flying over Table Mountain National Park without permission:</p><ul><li><strong>Report to SACAA:</strong> South African Civil Aviation Authority (enforcement@caa.co.za)</li><li><strong>Report to SanParks:</strong> Table Mountain National Park management (TableM@sanparks.org)</li><li><strong>Document evidence:</strong> Take photos/videos if safe to do so</li><li><strong>Note details:</strong> Time, location, aircraft registration if visible</li></ul><p>Use the report function on this site to generate a formal complaint with all relevant details.</p></div>'
                },
                {
                    question: 'Is this data accurate?',
                    answer: '<div><p>We strive for accuracy by:</p><ul><li><strong>Multiple data sources:</strong> Cross-referencing different tracking systems</li><li><strong>Manual verification:</strong> Checking flight plans and permissions</li><li><strong>Regular updates:</strong> Keeping data current and relevant</li><li><strong>Transparency:</strong> Showing our methodology and data sources</li></ul><p>However, flight tracking data can sometimes have inaccuracies. If you believe there is an error, please contact us with supporting evidence.</p></div>'
                }
            ];
            
            faqContent.innerHTML = faqs.map((faq, idx) => 
                '<div style="margin-bottom: 18px; border-bottom: 1px solid #eee; padding-bottom: 8px;">' +
                    '<button onclick="toggleFAQ(' + idx + ')" style="background: none; border: none; color: #007bff; font-weight: 600; font-size: 18px; cursor: pointer; width: 100%; text-align: left; padding: 8px 0; outline: none; display: flex; align-items: center; gap: 8px;">' +
                        '<span id="faqArrow' + idx + '">▶</span> ' + faq.question +
                    '</button>' +
                    '<div id="faqAnswer' + idx + '" style="display: none; margin-top: 8px; color: #333; font-size: 16px; text-align: left;">' + faq.answer + '</div>' +
                '</div>'
            ).join('');
        }
        
        function toggleFAQ(idx) {
            const answer = document.getElementById('faqAnswer' + idx);
            const arrow = document.getElementById('faqArrow' + idx);
            
            if (answer.style.display === 'none') {
                answer.style.display = 'block';
                arrow.textContent = '▼';
            } else {
                answer.style.display = 'none';
                arrow.textContent = '▶';
            }
        }
        
        // Global variable to track current viewing flight
        let currentViewingFlightFilename = null;
        
        // Viewing Flight Information Box Functions
        function showViewingFlight(flight) {
            const box = document.getElementById('viewingFlightBox');
            const title = document.getElementById('viewingFlightTitle');
            const date = document.getElementById('viewingFlightDate');
            const utc = document.getElementById('viewingFlightUTC');
            const sa = document.getElementById('viewingFlightSA');
            const reg = document.getElementById('viewingFlightReg');
            const filename = document.getElementById('viewingFlightFilename');
            const size = document.getElementById('viewingFlightSize');
            const download = document.getElementById('viewingFlightDownload');
            
            // Store current flight filename globally
            currentViewingFlightFilename = flight.filename;
            
            // Populate flight information
            title.textContent = 'Viewing Flight: ' + (flight.registration || 'Unknown');
            date.textContent = flight.date || '-';
            utc.textContent = flight.time || '-';
            sa.textContent = utcToSaTime(flight.date, flight.time);
            reg.textContent = flight.registration || '-';
            document.getElementById('viewingFlightOwner').textContent = flight.owner || '-';
            filename.textContent = flight.filename || '-';
            size.textContent = flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-';
            
            // Update download button
            download.onclick = () => downloadKML(flight.filename);
            
            // Show the box
            box.style.display = 'block';
        }
        
        function closeViewingFlight() {
            document.getElementById('viewingFlightBox').style.display = 'none';
            
            // Clear the current viewing flight filename
            currentViewingFlightFilename = null;
            
            // Clear the last viewed filename to remove highlighting
            lastViewedFilename = null;
            
            // Re-render table to remove highlighting
            renderTable();
            
            // Remove flight layer from map
            if (currentFlightLayer) {
                map.removeLayer(currentFlightLayer);
                currentFlightLayer = null;
            }
        }
        
            function jumpToTable() {
                // Scroll to the specific flight row using lastViewedFilename
                if (lastViewedFilename) {
                    const rowElement = document.getElementById('flight-' + lastViewedFilename);
                    if (rowElement) {
                        rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Flash effect to highlight the row
                        rowElement.style.transition = 'background-color 0.5s';
                        rowElement.style.backgroundColor = '#fff7e6';
                        setTimeout(() => {
                            rowElement.style.backgroundColor = '#e6f7ff';
                        }, 1000);
                    }
                } else {
                    // Fallback: scroll to table container if no specific flight
                    const tableContainer = document.getElementById('tableContainer');
                    tableContainer.scrollIntoView({ behavior: 'smooth' });
                }
            }
            
            function takeAction() {
                if (currentViewingFlightFilename) {
                    reportFlight(currentViewingFlightFilename);
                } else {
                    alert('No flight selected. Please click the eye button on a flight first.');
                }
            }
    </script>
</body>
</html>`;

// Write the HTML file
fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), htmlContent);

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

This static site can be deployed to any static hosting service:

- **GitHub Pages**: Free hosting for public repositories
- **Netlify**: Free tier with drag & drop deployment
- **Vercel**: Free tier with automatic deployments
- **AWS S3**: Low-cost static hosting
- **Any web server**: Traditional hosting

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
console.log(`   • kml/ (${fs.readdirSync(path.join(BUILD_DIR, 'kml')).length} KML files)`);
console.log(`   • flight-maps/ (served from GitHub LFS)`);
console.log('   • tmnp.kml (boundary file)');

console.log('\n🚀 Next Steps:');
console.log('1. Test the site locally: open static-site/index.html in your browser');
console.log('2. Deploy to your preferred hosting service');
console.log('3. Share the URL with users who need to view the data');

console.log('\n💡 Deployment Options:');
console.log('• GitHub Pages: Free, automatic updates from git');
console.log('• Netlify: Free, drag & drop deployment');
console.log('• Vercel: Free, automatic deployments');
console.log('• AWS S3: Low-cost, scalable hosting');
