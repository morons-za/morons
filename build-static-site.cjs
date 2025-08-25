#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Building Static Site for SiteGround Hosting...\n');

// Configuration
const BUILD_DIR = 'static-site';
const KML_SOURCE_DIR = 'server/uploads';
const PNG_SOURCE_DIR = 'server/flight-maps';
const TMNP_KML = 'public/tmnp.kml';

// Create build directory
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR);
  console.log('✅ Created build directory:', BUILD_DIR);
}

// Copy static assets
console.log('\n📁 Copying static assets...');

// Copy TMNP boundary file
if (fs.existsSync(TMNP_KML)) {
  fs.copyFileSync(TMNP_KML, path.join(BUILD_DIR, 'tmnp.kml'));
  console.log('✅ Copied TMNP boundary file');
}

// Copy KML files
if (fs.existsSync(KML_SOURCE_DIR)) {
  const kmlDir = path.join(BUILD_DIR, 'kml');
  if (!fs.existsSync(kmlDir)) fs.mkdirSync(kmlDir);
  
  const kmlFiles = fs.readdirSync(KML_SOURCE_DIR).filter(f => f.endsWith('.kml'));
  kmlFiles.forEach(file => {
    fs.copyFileSync(
      path.join(KML_SOURCE_DIR, file),
      path.join(kmlDir, file)
    );
  });
  console.log(`✅ Copied ${kmlFiles.length} KML files`);
}

// Copy PNG files
if (fs.existsSync(PNG_SOURCE_DIR)) {
  const pngDir = path.join(BUILD_DIR, 'flight-maps');
  if (!fs.existsSync(pngDir)) fs.mkdirSync(pngDir);
  
  const pngFiles = fs.readdirSync(PNG_SOURCE_DIR).filter(f => f.endsWith('.png'));
  pngFiles.forEach(file => {
    fs.copyFileSync(
      path.join(PNG_SOURCE_DIR, file),
      path.join(pngDir, file)
    );
  });
  console.log(`✅ Copied ${pngFiles.length} PNG files`);
}

// Generate flight data
console.log('\n📊 Generating flight data...');

let flightData = [];
try {
  // Load flight data from uploads directory
  const uploadsDir = 'server/uploads';
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.kml'));
    console.log(`📁 Found ${files.length} KML files in uploads directory`);
    
    flightData = [];
    for (const file of files) {
      try {
        // Extract metadata from filename (format: YYYY-MM-DD-REGISTRATION-HASH.kml)
        const parts = file.replace('.kml', '').split('-');
        if (parts.length >= 4) {
          const date = parts.slice(0, 3).join('-');
          const registration = parts[3];
          const hash = parts[4] || '';
          
          // Check if PNG exists
          const pngFile = file.replace('.kml', '.png');
          const hasPng = fs.existsSync(`server/flight-maps/${pngFile}`);
          
          // Get file size
          const stats = fs.statSync(`server/uploads/${file}`);
          const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          
          flightData.push({
            filename: file,
            date: date,
            time: '00:00', // Default time since we don't have it in filename
            registration: registration,
            owner: 'Unknown',
            fileSizeMB: fileSizeMB,
            hasPng: hasPng
          });
        }
      } catch (err) {
        console.log(`⚠️ Error processing ${file}:`, err.message);
      }
    }
    
    console.log(`✅ Loaded ${flightData.length} flights from uploads directory`);
  } else {
    console.log('❌ Uploads directory not found');
    flightData = [];
  }
} catch (error) {
  console.error('❌ Error loading flight data:', error.message);
  process.exit(1);
}

// Create the main HTML file
console.log('\n🌐 Creating main HTML file...');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TMNP Helicopter Tracking System</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .header { background: rgba(255,255,255,0.95); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(0,0,0,0.1); padding: 16px 32px; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; display: flex; justify-content: flex-end; gap: 16; align-items: center; }
        .header button { background: none; border: none; color: #007bff; font-weight: 600; font-size: 16; cursor: pointer; padding: 8px 12px; }
        .main-content { padding-top: 70px; max-width: 1200px; margin: 0 auto; padding-left: 20px; padding-right: 20px; }
        .main-title { text-align: center; margin: 24px 0 16px 0; color: #333; }
        #map { height: 600px; width: 100%; margin: 24px 0; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .filters { background: #f7f9fa; border-radius: 10px; padding: 24px; margin: 24px 0; border: 1px solid #e3e8ee; }
        .filters input, .filters select { padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; margin: 0 8px; }
        .filters button { padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin: 24px 0; }
        th, td { padding: 12px; border: 1px solid #ddd; text-align: left; }
        th { background: #f0f0f0; font-weight: 600; }
        .download-btn { background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
        .view-btn { background: #007bff; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
        .report-btn { background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
        .summary { text-align: center; margin: 24px 0; font-size: 18px; color: #223; }
        .loading { text-align: center; color: #007bff; margin: 24px 0; }
    </style>
</head>
<body>
    <div class="header">
        <button onclick="showHome()">Home</button>
        <button onclick="showFAQ()">FAQ</button>
    </div>

    <div class="main-content">
        <div id="local-file-warning" style="
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 12px 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            text-align: center;
            display: none;
        ">
            <strong>⚠️ Local File Warning:</strong> You're viewing this page as a local file. Some features may not work properly. 
            For full functionality, please use a local web server or deploy to hosting.
            <button onclick="this.parentElement.style.display='none'" style="
                margin-left: 12px;
                background: #856404;
                color: white;
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            ">Dismiss</button>
        </div>
        
        <h1 class="main-title">Misbehaving Operators Roaming Over National Sanctuaries</h1>
        
        <div id="map"></div>
        
        <div class="summary">
            Summary: <strong id="flight-count">0</strong> flight(s) shown with <i>likely</i> <strong>NP17</strong> airspace violations over Table Mountain National Park, from <strong id="heli-count">0</strong> helicopter(s)
        </div>
        
        <div class="filters">
            <h3>Filters</h3>
            <label>Registration: <input type="text" id="reg-filter" placeholder="Type registration..."></label>
            <label>Date from: <input type="date" id="date-start"></label>
            <label>Date to: <input type="date" id="date-end"></label>
            <button onclick="applyFilters()">Apply Filters</button>
            <button onclick="clearFilters()">Clear Filters</button>
            <button onclick="exportCSV()">Export CSV</button>
        </div>
        
        <div id="flights-table">
            <div class="loading">Loading flight data...</div>
        </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet-omnivore@0.3.4/leaflet-omnivore.js"></script>
    
    <script>
        // Flight data embedded directly in the page
        const flightData = ${JSON.stringify(flightData.flights || flightData, null, 2)};
        
        let map;
        let currentFlightLayer = null;
        let tmnpLayer = null;
        
        // Initialize map
        function initMap() {
            map = L.map('map').setView([-33.9249, 18.4241], 10);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            // Add TMNP boundary
            if (tmnpLayer) map.removeLayer(tmnpLayer);
            tmnpLayer = omnivore.kml('tmnp.kml')
                .on('ready', function() {
                    this.setStyle(() => ({
                        color: '#ff0000',
                        weight: 3,
                        opacity: 0.7,
                        fillColor: '#ff0000',
                        fillOpacity: 0.25
                    }));
                })
                .addTo(map);
        }
        
        // Display flights
        function displayFlights(flights = flightData) {
            const table = document.getElementById('flights-table');
            const flightCount = document.getElementById('flight-count');
            const heliCount = document.getElementById('heli-count');
            
            flightCount.textContent = flights.length;
            heliCount.textContent = new Set(flights.map(f => f.registration).filter(r => r && r !== '-')).size;
            
            if (flights.length === 0) {
                table.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">No flights found matching your filters.</div>';
                return;
            }
            
            const tableHTML = \`
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>UTC Time</th>
                            <th>SA Time</th>
                            <th>Registration</th>
                            <th>Filename</th>
                            <th>Size</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${flights.map(flight => \`
                            <tr>
                                <td>\${flight.date || '-'}</td>
                                <td>\${flight.time || '-'}</td>
                                <td>\${utcToSaTime(flight.date, flight.time)}</td>
                                <td>\${flight.registration || '-'}</td>
                                <td>\${flight.filename || '-'}</td>
                                <td>\${flight.fileSizeMB ? flight.fileSizeMB + ' MB' : '-'}</td>
                                <td>
                                    <a href="kml/\${flight.filename}" class="download-btn" download>⬇️ KML</a>
                                    <button class="view-btn" onclick="viewFlight('\${flight.filename}')">👀 View</button>
                                    <button class="report-btn" onclick="generateReport(\${JSON.stringify(flight)})">👮‍♂️ Report</button>
                                </td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
            
            table.innerHTML = tableHTML;
        }
        
        // Convert UTC to SA time
        function utcToSaTime(date, time) {
            if (!date || !time) return '-';
            const utc = new Date(\`\${date}T\${time}:00Z\`);
            const sa = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
            return sa.toISOString().slice(11, 16);
        }
        
        // View flight on map
        function viewFlight(filename) {
            try {
                if (currentFlightLayer) map.removeLayer(currentFlightLayer);
                
                // Show loading state
                const button = event.target;
                const originalText = button.textContent;
                button.textContent = 'Loading...';
                button.disabled = true;
                
                currentFlightLayer = omnivore.kml(\`kml/\${filename}\`)
                    .on('ready', function() {
                        this.setStyle(() => ({
                            color: '#0000ff',
                            weight: 4,
                            opacity: 0.8
                        }));
                        
                        if (tmnpLayer) {
                            const group = L.featureGroup([tmnpLayer, this]);
                            map.fitBounds(group.getBounds(), { padding: [20, 20] });
                        } else {
                            map.fitBounds(this.getBounds(), { padding: [20, 20] });
                        }
                        
                        // Restore button
                        button.textContent = originalText;
                        button.disabled = false;
                        
                        // Show success feedback
                        button.textContent = '✅ Loaded';
                        setTimeout(() => {
                            button.textContent = originalText;
                        }, 2000);
                    })
                    .on('error', function() {
                        alert('Failed to load flight path. Please check if the KML file exists.');
                        button.textContent = originalText;
                        button.disabled = false;
                    })
                    .addTo(map);
            } catch (error) {
                console.error('Error viewing flight:', error);
                alert('Error loading flight path. Please try again.');
                if (button) {
                    button.textContent = originalText;
                    button.disabled = false;
                }
            }
        }
        
        // Generate violation report
        function generateReport(flight) {
            try {
                const reportText = \`It appears that a helicopter, registration \${flight.registration} (\${flight.owner || 'Private owner'}), entered restricted NP17 airspace over Table Mountain on \${flight.date}.\`;
                
                // Create a modal with the report
                const modal = document.createElement('div');
                modal.style.cssText = \`
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 2000;
                    padding: 20px;
                \`;
                
                modal.innerHTML = \`
                    <div style="
                        background: white;
                        border-radius: 12px;
                        padding: 24px;
                        max-width: 600px;
                        width: 100%;
                        max-height: 90vh;
                        overflow: auto;
                        box-shadow: 0 8px 32px rgba(0,0,0,0.3)
                    ">
                        <h2 style="margin: 0 0 20px 0; color: #333;">Flight Violation Report</h2>
                        
                        <div style="
                            background: #f8f9fa;
                            padding: 16px;
                            border-radius: 8px;
                            border: 1px solid #dee2e6;
                            margin-bottom: 20px;
                            font-family: monospace;
                            font-size: 14px;
                            line-height: 1.5;
                        ">
                            \${reportText}
                        </div>
                        
                        <div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 20px;">
                            <button onclick="copyToClipboard('\${reportText}')" style="
                                padding: 8px 16px;
                                background: #007bff;
                                color: white;
                                border: none;
                                border-radius: 6px;
                                cursor: pointer;
                                font-weight: 600;
                            ">
                                📋 Copy Text
                            </button>
                            
                            <button onclick="openEmailClient('\${flight.registration}', '\${flight.owner || 'Private owner'}', '\${flight.date}')" style="
                                padding: 8px 16px;
                                background: #dc3545;
                                color: white;
                                border: none;
                                border-radius: 6px;
                                cursor: pointer;
                                font-weight: 600;
                            ">
                                ✈️ Report to SACAA
                            </button>
                        </div>
                        
                        <div style="text-align: center;">
                            <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove()" style="
                                padding: 10px 24px;
                                background: #6c757d;
                                color: white;
                                border: none;
                                border-radius: 6px;
                                cursor: pointer;
                                font-weight: 600;
                            ">
                                Close
                            </button>
                        </div>
                    </div>
                \`;
                
                document.body.appendChild(modal);
                
                // Close modal when clicking outside
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.remove();
                });
                
            } catch (error) {
                console.error('Error generating report:', error);
                alert('Error generating report. Please try again.');
            }
        }
        
        // Copy text to clipboard
        function copyToClipboard(text) {
            try {
                navigator.clipboard.writeText(text).then(() => {
                    alert('Report text copied to clipboard!');
                }).catch(() => {
                    // Fallback for older browsers
                    const textArea = document.createElement('textarea');
                    textArea.value = text;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    alert('Report text copied to clipboard!');
                });
            } catch (error) {
                alert('Could not copy to clipboard. Please copy manually:\\n\\n' + text);
            }
        }
        
        // Open email client
        function openEmailClient(registration, owner, date) {
            const reportText = \`It appears that a helicopter, registration \${registration} (\${owner}), entered restricted NP17 airspace over Table Mountain on \${date}.\`;
            const mailtoUrl = \`mailto:enforcement@caa.co.za?subject=Helicopter Airspace Violation Report - \${registration}&body=\${encodeURIComponent(reportText)}\`;
            window.open(mailtoUrl);
        }
        
        // Filter functions
        function applyFilters() {
            const regFilter = document.getElementById('reg-filter').value.toLowerCase();
            const dateStart = document.getElementById('date-start').value;
            const dateEnd = document.getElementById('date-end').value;
            
            let filtered = flightData.filter(flight => {
                if (regFilter && !flight.registration?.toLowerCase().includes(regFilter)) return false;
                if (dateStart && flight.date < dateStart) return false;
                if (dateEnd && flight.date > dateEnd) return false;
                return true;
            });
            
            displayFlights(filtered);
        }
        
        function clearFilters() {
            document.getElementById('reg-filter').value = '';
            document.getElementById('date-start').value = '';
            document.getElementById('date-end').value = '';
            displayFlights();
        }
        
        // Export CSV
        function exportCSV() {
            const headers = ['Date', 'UTC Time', 'SA Time', 'Registration', 'Filename', 'Size (MB)'];
            const rows = flightData.map(flight => [
                flight.date || '',
                flight.time || '',
                utcToSaTime(flight.date, flight.time),
                flight.registration || '',
                flight.filename || '',
                flight.fileSizeMB || ''
            ]);
            
            const csvContent = [headers, ...rows].map(r => r.map(x => \`"\${String(x).replace(/"/g, '""')}"\`).join(',')).join('\\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'flights.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        
        // Navigation functions
        function showHome() {
            // Already on home page
        }
        
        function showFAQ() {
            alert('FAQ functionality would be implemented here. For now, please refer to the main page.');
        }
        
        // Initialize everything when page loads
        window.addEventListener('load', function() {
            initMap();
            displayFlights();
            
            // Check if viewing as local file
            if (window.location.protocol === 'file:') {
                const warning = document.getElementById('local-file-warning');
                if (warning) warning.style.display = 'block';
            }
        });
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), htmlContent);
console.log('✅ Created main HTML file');

// Create a simple README for deployment
const readmeContent = `# Static Site for SiteGround Hosting

This is a static version of your TMNP Helicopter Tracking System.

## Files:
- \`index.html\` - Main website
- \`kml/\` - KML flight files
- \`flight-maps/\` - PNG flight map images
- \`tmnp.kml\` - TMNP boundary file

## Deployment:
1. Upload all files to your SiteGround hosting
2. Make sure the file structure is preserved
3. Your website will work without any server-side processing

## Updates:
When you add new KML files:
1. Process them locally using your validation portal
2. Run \`node build-static-site.cjs\` to rebuild
3. Upload the new \`static-site\` folder to SiteGround

## Benefits:
- ✅ No server costs
- ✅ No maintenance
- ✅ Same functionality for users
- ✅ Faster loading
- ✅ More reliable hosting
`;

fs.writeFileSync(path.join(BUILD_DIR, 'README.md'), readmeContent);
console.log('✅ Created deployment README');

// Summary
console.log('\n🎉 Static site build complete!');
console.log('\n📁 Files created in:', BUILD_DIR);
console.log('📊 Total flights:', flightData.flights ? flightData.flights.length : flightData.length);
console.log('🗺️ KML files:', fs.readdirSync(KML_SOURCE_DIR).filter(f => f.endsWith('.kml')).length);
console.log('🖼️ PNG files:', fs.readdirSync(PNG_SOURCE_DIR).filter(f => f.endsWith('.png')).length);

console.log('\n🚀 Next steps:');
console.log('1. Upload the \`static-site\` folder to your SiteGround hosting');
console.log('2. Your website will work exactly the same but much cheaper!');
console.log('3. To update: process new KML files locally, then run this script again');
