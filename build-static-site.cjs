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
  tmnpBoundary: 'tmnp.kml'
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
    
    // Convert to flat array format
    flightData = Object.values(masterMetadata).filter(flight => 
      flight && flight.filename && flight.registration
    );
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            font-weight: 300;
        }
        
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 20px;
        }
        
        .summary {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            margin: 2rem 0;
            box-shadow: 0 2px 20px rgba(0,0,0,0.08);
            text-align: center;
        }
        
        .summary h2 {
            color: #2c3e50;
            margin-bottom: 1rem;
            font-size: 1.8rem;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        
        .stat {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: #6c757d;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .map-container {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            margin: 2rem 0;
            box-shadow: 0 2px 20px rgba(0,0,0,0.08);
        }
        
        #map {
            height: 600px;
            width: 100%;
            border-radius: 8px;
            border: 1px solid #e9ecef;
        }
        
        .controls {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            margin: 2rem 0;
            box-shadow: 0 2px 20px rgba(0,0,0,0.08);
        }
        
        .controls h3 {
            color: #2c3e50;
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }
        
        .filter-row {
            display: flex;
            gap: 1rem;
            align-items: end;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }
        
        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        
        .filter-group label {
            font-weight: 600;
            color: #495057;
            font-size: 0.9rem;
        }
        
        .filter-group input, .filter-group select {
            padding: 0.5rem;
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 0.9rem;
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
        
        .table-container {
            background: white;
            border-radius: 12px;
            padding: 1.5rem;
            margin: 2rem 0;
            box-shadow: 0 2px 20px rgba(0,0,0,0.08);
            overflow-x: auto;
        }
        
        .table-container h3 {
            color: #2c3e50;
            margin-bottom: 1rem;
            font-size: 1.5rem;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
        }
        
        th, td {
            padding: 0.75rem;
            text-align: left;
            border-bottom: 1px solid #e9ecef;
        }
        
        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
            position: sticky;
            top: 0;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .flight-row {
            cursor: pointer;
        }
        
        .flight-row:hover {
            background: #e3f2fd !important;
        }
        
        .action-btn {
            padding: 0.25rem 0.5rem;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8rem;
            margin: 0 0.25rem;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-view {
            background: #007bff;
            color: white;
        }
        
        .btn-download {
            background: #28a745;
            color: white;
        }
        
        .btn-report {
            background: #dc3545;
            color: white;
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
            padding: 2rem;
            color: #6c757d;
        }
        
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 1rem;
            border-radius: 4px;
            margin: 1rem 0;
        }
        
        @media (max-width: 768px) {
            .header h1 {
                font-size: 2rem;
            }
            
            .filter-row {
                flex-direction: column;
                align-items: stretch;
            }
            
            .stats {
                grid-template-columns: 1fr;
            }
            
            .table-container {
                overflow-x: auto;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="container">
            <h1>🚁 TMNP Helicopter Tracking</h1>
            <p>Airspace Violations Over Table Mountain National Park</p>
        </div>
    </div>

    <div class="container">
        <div class="summary">
            <h2>📊 Flight Summary</h2>
            <div class="stats">
                <div class="stat">
                    <div class="stat-number">${flightData.length}</div>
                    <div class="stat-label">Total Flights</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${new Set(flightData.map(f => f.registration)).size}</div>
                    <div class="stat-label">Unique Helicopters</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${flightData.length > 0 ? flightData[0].date : 'N/A'}</div>
                    <div class="stat-label">Latest Flight</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${flightData.length > 0 ? flightData[flightData.length - 1].date : 'N/A'}</div>
                    <div class="stat-label">Earliest Flight</div>
                </div>
            </div>
        </div>

        <div class="map-container">
            <h3>🗺️ Interactive Map</h3>
            <div id="map"></div>
        </div>

        <div class="controls">
            <h3>🔧 Tools & Filters</h3>
            <div class="filter-row">
                <div class="filter-group">
                    <label for="registrationFilter">Registration:</label>
                    <input type="text" id="registrationFilter" placeholder="Type registration...">
                </div>
                <div class="filter-group">
                    <label for="dateStart">Date from:</label>
                    <input type="date" id="dateStart">
                </div>
                <div class="filter-group">
                    <label for="dateEnd">Date to:</label>
                    <input type="date" id="dateEnd">
                </div>
                <div class="filter-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary" onclick="applyFilters()">Apply Filters</button>
                </div>
                <div class="filter-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-info" onclick="clearFilters()">Clear Filters</button>
                </div>
                <div class="filter-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-success" onclick="exportCSV()">Export CSV</button>
                </div>
            </div>
        </div>

        <div class="table-container">
            <h3>📋 Flight Details</h3>
            <div id="tableContainer">
                <div class="loading">Loading flight data...</div>
            </div>
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
            
            // Add TMNP boundary
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
        }
        
        function updateSummary() {
            const uniqueHelicopters = new Set(filteredData.map(f => f.registration)).size;
            const dateRange = filteredData.length > 0 ? 
                \`\${filteredData[filteredData.length - 1].date} to \${filteredData[0].date}\` : 'N/A';
            
            document.querySelector('.stat-number').textContent = filteredData.length;
            document.querySelectorAll('.stat-number')[1].textContent = uniqueHelicopters;
            document.querySelectorAll('.stat-number')[3].textContent = dateRange;
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
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Registration</th>
                            <th>Filename</th>
                            <th>Size</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${sortedData.map(flight => \`
                            <tr class="flight-row" onclick="viewFlight('\${flight.filename}')">
                                <td>\${flight.date || '-'}</td>
                                <td>\${flight.time || '-'}</td>
                                <td>\${flight.registration || '-'}</td>
                                <td>\${flight.filename || '-'}</td>
                                <td>\${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-'}</td>
                                <td>
                                    <button class="action-btn btn-view" onclick="event.stopPropagation(); viewFlight('\${flight.filename}')">👁️ View</button>
                                    <a href="kml/\${flight.filename}" download class="action-btn btn-download">⬇️ KML</a>
                                    <button class="action-btn btn-report" onclick="event.stopPropagation(); reportFlight('\${flight})">🚨 Report</button>
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
                    <a href="kml/\${flight.filename}" download class="btn btn-success">⬇️ Download KML</a>
                    <button class="btn btn-primary" onclick="loadFlightOnMap('\${flight.filename}')">🗺️ Show on Map</button>
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
            
            // Load KML file
            fetch(\`kml/\${filename}\`)
                .then(response => response.text())
                .then(kmlText => {
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
                .catch(error => console.log('Could not load flight path:', error));
            
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
console.log('   • kml/ (${fs.readdirSync(path.join(BUILD_DIR, 'kml')).length} KML files)');
console.log('   • flight-maps/ (${fs.readdirSync(path.join(BUILD_DIR, 'flight-maps')).length} PNG files)');
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
