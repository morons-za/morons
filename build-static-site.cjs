#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building Static Site for TMNP Helicopter Tracking...\n');

// Configuration
const BUILD_DIR = 'static-site';
const SOURCE_DIRS = {
  uploads: 'server/uploads',
  flightMaps: 'server/flight-maps',
  tmnpBoundary: 'public/tmnp.kml'
};

// Clean and create build directory
if (fs.existsSync(BUILD_DIR)) {
  console.log('🧹 Cleaning existing build directory...');
  fs.rmSync(BUILD_DIR, { recursive: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Create subdirectories
fs.mkdirSync(path.join(BUILD_DIR, 'kml'), { recursive: true });
fs.mkdirSync(path.join(BUILD_DIR, 'flight-maps'), { recursive: true });

console.log('📁 Created build directory structure');

// Copy static assets
console.log('\n📋 Copying static assets...');

// Copy TMNP boundary
if (fs.existsSync(SOURCE_DIRS.tmnpBoundary)) {
  fs.copyFileSync(SOURCE_DIRS.tmnpBoundary, path.join(BUILD_DIR, 'tmnp.kml'));
  console.log('✅ Copied TMNP boundary file');
} else {
  console.log('⚠️  TMNP boundary file not found');
}

// Copy KML files
if (fs.existsSync(SOURCE_DIRS.uploads)) {
  const kmlFiles = fs.readdirSync(SOURCE_DIRS.uploads).filter(f => f.endsWith('.kml'));
  console.log(`📁 Copying ${kmlFiles.length} KML files...`);
  
  kmlFiles.forEach(file => {
    const sourcePath = path.join(SOURCE_DIRS.uploads, file);
    const destPath = path.join(BUILD_DIR, 'kml', file);
    fs.copyFileSync(sourcePath, destPath);
  });
  console.log('✅ Copied all KML files');
} else {
  console.log('⚠️  Uploads directory not found');
}

// Copy PNG flight maps
if (fs.existsSync(SOURCE_DIRS.flightMaps)) {
  const pngFiles = fs.readdirSync(SOURCE_DIRS.flightMaps).filter(f => f.endsWith('.png'));
  console.log(`🖼️  Copying ${pngFiles.length} PNG flight maps...`);
  
  pngFiles.forEach(file => {
    const sourcePath = path.join(SOURCE_DIRS.flightMaps, file);
    const destPath = path.join(BUILD_DIR, 'flight-maps', file);
    fs.copyFileSync(sourcePath, destPath);
  });
  console.log('✅ Copied all PNG flight maps');
} else {
  console.log('⚠️  Flight maps directory not found');
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

// Generate the main HTML file
console.log('\n🌐 Generating static HTML...');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TMNP Helicopter Tracking - Airspace Violations</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
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
        
        #map {
            height: 600px;
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
        
        <div id="map"></div>
        
        <div class="summary">
            <div class="summary-text">
                Summary: <strong>${flightData.length} flight${flightData.length === 1 ? '' : 's'} shown</strong> with <i>likely</i> <strong>NP17</strong> airspace violations over Table Mountain National Park, from <strong>${new Set(flightData.map(f => f.registration)).size} helicopter${new Set(flightData.map(f => f.registration)).size === 1 ? '' : 's'}</strong>, with flight logs shown from <strong>${flightData.length > 0 ? flightData.map(f => f.date).sort()[0] : ''}</strong> <span style="font-weight: 500">to</span> <strong>${flightData.length > 0 ? flightData.map(f => f.date).sort()[flightData.map(f => f.date).sort().length - 1] : ''}</strong>
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
            <div class="loading">Loading flight data...</div>
        </div>
    </div>

    <!-- Flight Details Modal -->
    <div id="flightModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <div id="modalContent"></div>
        </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        // Flight data embedded from build process
        const flightData = ${JSON.stringify(flightData, null, 2)};
        
        // Global variables
        let map;
        let currentFlightLayer = null;
        let filteredData = [...flightData];
        let showFilters = false;
        
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
        
        // Initialize the application
        document.addEventListener('DOMContentLoaded', function() {
            initializeMap();
            renderTable();
            setupEventListeners();
        });
        
        function initializeMap() {
            // Initialize map centered on Cape Town
            map = L.map('map').setView([-33.9249, 18.4241], 10);
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            // Add TMNP boundary with loading indicator and instruction overlay
            fetch('tmnp.kml')
                .then(response => response.text())
                .then(kmlText => {
                    // Simple KML parsing for boundary
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                    const coordinates = kmlDoc.querySelectorAll('coordinates');
                    
                    coordinates.forEach(coord => {
                        const coordText = coord.textContent.trim();
                        const points = coordText.split('\\n').map(line => {
                            const [lon, lat] = line.trim().split(',').map(Number);
                            return [lat, lon];
                        }).filter(point => !isNaN(point[0]) && !isNaN(point[1]));
                        
                        if (points.length > 2) {
                            L.polygon(points, {
                                color: '#ff0000',
                                weight: 3,
                                opacity: 0.7,
                                fillColor: '#ff0000',
                                fillOpacity: 0.25
                            }).addTo(map);
                        }
                    });
                    
                    // Fit bounds to TMNP
                    if (coordinates.length > 0) {
                        const allPoints = [];
                        coordinates.forEach(coord => {
                            const coordText = coord.textContent.trim();
                            const points = coordText.split('\\n').map(line => {
                                const [lon, lat] = line.trim().split(',').map(Number);
                                return [lat, lon];
                            }).filter(point => !isNaN(point[0]) && !isNaN(point[1]));
                            allPoints.push(...points);
                        });
                        
                        if (allPoints.length > 0) {
                            const bounds = L.latLngBounds(allPoints);
                            map.fitBounds(bounds, { padding: [20, 20] });
                        }
                    }
                    
                    // Show initial instruction overlay
                    const instructionDiv = document.createElement('div');
                    instructionDiv.innerHTML = \`
                        <div style="text-align: center; line-height: 1.4;">
                            <div style="font-size: 18px; margin-bottom: 8px;">🗺️ Flight Tracking Map</div>
                            <div style="font-size: 14px; margin-bottom: 12px;">Scroll down to view flights</div>
                            <div style="font-size: 12px; color: #ccc;">Click the 👀 button on any flight to see its path</div>
                        </div>
                    \`;
                    instructionDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 25px 35px; border-radius: 12px; z-index: 1000; font-size: 14px; font-weight: 500; box-shadow: 0 6px 20px rgba(0,0,0,0.4); max-width: 300px;';
                    map.getContainer().appendChild(instructionDiv);
                    
                    // Auto-hide instruction after 8 seconds
                    setTimeout(() => {
                        if (instructionDiv.parentNode) {
                            instructionDiv.parentNode.removeChild(instructionDiv);
                        }
                    }, 8000);
                })
                .catch(error => console.log('Could not load TMNP boundary:', error));
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
            
            // Update main summary
            const summaryText = document.querySelector('.summary-text');
            summaryText.innerHTML = \`Summary: <strong>\${filteredData.length} flight\${filteredData.length === 1 ? '' : 's'} shown</strong> with <i>likely</i> <strong>NP17</strong> airspace violations over Table Mountain National Park, from <strong>\${uniqueHelicopters} helicopter\${uniqueHelicopters === 1 ? '' : 's'}</strong>, with flight logs shown from <strong>\${startDate}</strong> <span style="font-weight: 500">to</span> <strong>\${endDate}</strong>\`;
            
            // Update filter summary
            const filterSummary = document.getElementById('filterSummary');
            if (filteredData.length === flightData.length) {
                filterSummary.textContent = 'All flights';
            } else {
                filterSummary.textContent = \`\${filteredData.length} of \${flightData.length} flights\`;
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
                            <th>Filename</th>
                            <th>KML</th>
                            <th>Size</th>
                            <th>View Flight</th>
                            <th>Take action</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${sortedData.map(flight => \`
                            <tr class="flight-row" onclick="viewFlight('\${flight.filename}')">
                                <td>\${flight.date || '-'}</td>
                                <td>\${flight.time || '-'}</td>
                                <td>\${utcToSaTime(flight.date, flight.time)}</td>
                                <td>\${flight.registration || '-'}</td>
                                <td>\${flight.filename || '-'}</td>
                                <td style="text-align: center;">
                                    <a href="https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/\${flight.filename}" download="\${flight.filename}" title="Download KML" style="font-size: 1.3em; color: #007bff; text-decoration: none; cursor: pointer;" onclick="event.stopPropagation(); downloadKML('\${flight.filename}'); return false;">⬇️</a>
                                </td>
                                <td style="text-align: center;">\${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-'}</td>
                                <td>
                                    <button onclick="event.stopPropagation(); loadFlightOnMap('\${flight.filename}')" style="padding: 4px 12px; border-radius: 4px; background: #007bff; color: #fff; border: none; cursor: pointer; font-size: 1.2em;" title="View on map">👀</button>
                                </td>
                                <td>
                                    <button onclick="event.stopPropagation(); reportFlight('\${flight})" style="padding: 6px 12px; border-radius: 4px; background: #dc3545; color: #fff; border: none; cursor: pointer; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 4px;" title="Generate violation report">👮‍♂️</button>
                                </td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
            
            container.innerHTML = tableHTML;
            updateSummary();
        }
        
        function viewFlight(filename) {
            const flight = flightData.find(f => f.filename === filename);
            if (!flight) return;
            
            const modal = document.getElementById('flightModal');
            const content = document.getElementById('modalContent');
            
            content.innerHTML = \`
                <h2>Flight Details: \${flight.registration}</h2>
                <div class="flight-details">
                    <p><strong>Date:</strong> \${flight.date}</p>
                    <p><strong>Time:</strong> \${flight.time}</p>
                    <p><strong>Registration:</strong> \${flight.registration}</p>
                    <p><strong>Filename:</strong> \${flight.filename}</p>
                    <p><strong>File Size:</strong> \${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : 'Unknown'}</p>
                </div>
                <div style="margin-top: 1rem;">
                    <a href="https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/\${flight.filename}" download="\${flight.filename}" class="btn btn-success" onclick="downloadKML('\${flight.filename}'); return false;">⬇️ Download KML</a>
                    <button class="btn btn-primary" onclick="loadFlightOnMap('\${flight.filename}')" style="padding: 4px 12px; border-radius: 4px; background: #007bff; color: #fff; border: none; cursor: pointer; font-size: 1.2em;">👀 View on Map</button>
                </div>
            \`;
            
            // Check if flight map exists
            const pngFilename = flight.filename.replace('.kml', '.png');
            if (flight.fileSizeMB) {
                content.innerHTML += \`
                    <div style="margin-top: 1rem;">
                        <h3>Flight Path Map</h3>
                        <img src="flight-maps/\${pngFilename}" alt="Flight path" class="flight-map" onerror="this.style.display='none'">
                    </div>
                \`;
            }
            
            modal.style.display = 'block';
        }
        
        function closeModal() {
            document.getElementById('flightModal').style.display = 'none';
        }
        
        function loadFlightOnMap(filename) {
            const flight = flightData.find(f => f.filename === filename);
            if (!flight) return;
            
            // Remove previous flight layer
            if (currentFlightLayer) {
                map.removeLayer(currentFlightLayer);
            }
            
            // Show loading indicator in center of map
            const loadingDiv = document.createElement('div');
            loadingDiv.innerHTML = '🔄 Loading flight path...';
            loadingDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 30px; border-radius: 10px; z-index: 1000; font-size: 16px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
            map.getContainer().appendChild(loadingDiv);
            
            // Load KML file from GitHub LFS
            const githubUrl = \`https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/\${filename}\`;
            fetch(githubUrl)
                .then(response => response.text())
                .then(kmlText => {
                    // Remove loading indicator
                    if (loadingDiv.parentNode) {
                        loadingDiv.parentNode.removeChild(loadingDiv);
                    }
                    
                    // Simple KML parsing for flight path
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlText, 'text/xml');
                    const coordinates = kmlDoc.querySelectorAll('coordinates');
                    
                    coordinates.forEach(coord => {
                        const coordText = coord.textContent.trim();
                        const points = coordText.split('\\n').map(line => {
                            const [lon, lat] = line.trim().split(',').map(Number);
                            return [lat, lon];
                        }).filter(point => !isNaN(point[0]) && !isNaN(point[1]));
                        
                        if (points.length > 1) {
                            currentFlightLayer = L.polyline(points, {
                                color: '#0000ff',
                                weight: 4,
                                opacity: 0.8
                            }).addTo(map);
                            
                            map.fitBounds(currentFlightLayer.getBounds(), { padding: [20, 20] });
                        }
                    });
                })
                .catch(error => {
                    console.log('Could not load flight path:', error);
                    if (loadingDiv.parentNode) {
                        loadingDiv.parentNode.removeChild(loadingDiv);
                    }
                });
            
            closeModal();
        }
        
        function reportFlight(flight) {
            const subject = encodeURIComponent(\`Airspace Violation Report: \${flight.registration}\`);
            const body = encodeURIComponent(\`
Airspace Violation Report

Aircraft Registration: \${flight.registration}
Date: \${flight.date}
Time: \${flight.time}
Filename: \${flight.filename}

This flight appears to have violated NP17 airspace restrictions over Table Mountain National Park.

Please investigate this violation and take appropriate action.

Report generated from TMNP Helicopter Tracking System.
            \`);
            
            window.open(\`mailto:?subject=\${subject}&body=\${body}\`);
        }
        
        function exportCSV() {
            const headers = ['Date', 'Time', 'Registration', 'Filename', 'Size (MB)'];
            const csvContent = [
                headers.join(','),
                ...filteredData.map(flight => [
                    flight.date || '',
                    flight.time || '',
                    flight.registration || '',
                    flight.filename || '',
                    flight.fileSizeMB || ''
                ].join(','))
            ].join('\\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`tmnp-flights-\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
            window.URL.revokeObjectURL(url);
        }
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('flightModal');
            if (event.target === modal) {
                closeModal();
            }
        }
        
        // KML download function
        async function downloadKML(filename) {
            const url = \`https://media.githubusercontent.com/media/werneravr/heli-map/main/server/uploads/\${filename}\`;
            
            try {
                // Show loading indicator
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '⏳ Downloading...';
                button.disabled = true;
                
                // Fetch the file content
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(\`HTTP error! status: \${response.status}\`);
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
            window.location.href = '/';
        }
        
        function showFAQ() {
            alert('FAQ: This is a static version of the TMNP Helicopter Tracking System. Use the filters to search flights and click the eye button to view flight paths on the map.');
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
console.log(`   • flight-maps/ (${fs.readdirSync(path.join(BUILD_DIR, 'flight-maps')).length} PNG files)`);
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
