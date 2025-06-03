const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const sharp = require('sharp');
const axios = require('axios');

// Function to extract TMNP coordinates from the KML file
function loadTMNPCoordinates() {
  const tmnpKmlPath = path.join(__dirname, '..', 'public', 'tmnp.kml');
  
  if (!fs.existsSync(tmnpKmlPath)) {
    console.log('⚠️ TMNP KML file not found, using simplified boundary');
    return [];
  }
  
  try {
    const tmnpXmlData = fs.readFileSync(tmnpKmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(tmnpXmlData);
    
    // Extract polygons properly - handle multiple polygons and inner rings
    const polygons = [];
    
    function findPolygons(obj) {
      if (!obj || typeof obj !== 'object') return;
      
      // Handle MultiGeometry with multiple Polygons
      if (obj.MultiGeometry && obj.MultiGeometry.Polygon) {
        const polygonArray = Array.isArray(obj.MultiGeometry.Polygon) ? 
          obj.MultiGeometry.Polygon : [obj.MultiGeometry.Polygon];
        
        for (const polygon of polygonArray) {
          const polygonData = extractPolygonCoordinates(polygon);
          if (polygonData) {
            polygons.push(polygonData);
          }
        }
      }
      
      // Handle single Polygon
      if (obj.Polygon) {
        const polygonData = extractPolygonCoordinates(obj.Polygon);
        if (polygonData) {
          polygons.push(polygonData);
        }
      }
      
      // Recursively search for more polygons
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          findPolygons(obj[key]);
        }
      }
    }
    
    function extractPolygonCoordinates(polygon) {
      const polygonData = { outer: [], inner: [] };
      
      // Extract outer boundary
      if (polygon.outerBoundaryIs && polygon.outerBoundaryIs.LinearRing && polygon.outerBoundaryIs.LinearRing.coordinates) {
        const coords = parseCoordinateString(polygon.outerBoundaryIs.LinearRing.coordinates);
        if (coords.length > 0) {
          polygonData.outer = coords;
        }
      }
      
      // Extract inner boundaries (holes)
      if (polygon.innerBoundaryIs) {
        const innerBoundaries = Array.isArray(polygon.innerBoundaryIs) ? 
          polygon.innerBoundaryIs : [polygon.innerBoundaryIs];
        
        for (const innerBoundary of innerBoundaries) {
          if (innerBoundary.LinearRing && innerBoundary.LinearRing.coordinates) {
            const coords = parseCoordinateString(innerBoundary.LinearRing.coordinates);
            if (coords.length > 0) {
              polygonData.inner.push(coords);
            }
          }
        }
      }
      
      return polygonData.outer.length > 0 ? polygonData : null;
    }
    
    function parseCoordinateString(coordString) {
      const coords = [];
      if (typeof coordString === 'string') {
        const coordPairs = coordString.trim().split(/\s+/);
        for (const pair of coordPairs) {
          const parts = pair.split(',');
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              coords.push([lon, lat]);
            }
          }
        }
      }
      return coords;
    }
    
    findPolygons(xml);
    
    if (polygons.length > 0) {
      const totalCoords = polygons.reduce((sum, p) => sum + p.outer.length + p.inner.reduce((innerSum, ring) => innerSum + ring.length, 0), 0);
      console.log(`✅ Loaded ${polygons.length} TMNP polygons with ${totalCoords} total boundary points`);
      return polygons;
    }
  } catch (e) {
    console.log(`⚠️ Error parsing TMNP KML: ${e.message}`);
  }
  
  return [];
}

// Extract flight metadata from KML filename and content
function extractFlightMetadata(kmlFilename, xml) {
  // Extract date from filename (format: 2025-05-29-ZS-HMB-727b7ddf.kml)
  const dateMatch = kmlFilename.match(/(\d{4}-\d{2}-\d{2})/);
  const regMatch = kmlFilename.match(/(\d{4}-\d{2}-\d{2})-([A-Z]{2}-[A-Z0-9]{3})/);
  
  const metadata = {
    date: dateMatch ? dateMatch[1] : 'Unknown Date',
    registration: regMatch ? regMatch[2] : 'Unknown Registration',
    owner: 'Unknown Owner'
  };
  
  // Try to extract owner from KML content
  function findOwner(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Look for owner information in description fields
    if (obj.description && typeof obj.description === 'string') {
      const desc = obj.description;
      
      // Look for owner text that comes after the registration in HTML content
      // Pattern: registration followed by <br/> and then owner text
      const ownerPattern = new RegExp(metadata.registration.replace('-', '') + '<br\\s*\\/?>([^<]+)', 'i');
      const ownerMatch = desc.match(ownerPattern);
      if (ownerMatch) {
        const owner = ownerMatch[1].trim();
        if (owner && owner.length > 0 && !owner.includes('<') && !owner.includes('>')) {
          metadata.owner = owner;
          return;
        }
      }
      
      // Alternative pattern: look for text after registration and before </div>
      const altPattern = new RegExp(metadata.registration.replace('-', '') + '<br\\s*\\/?>\\s*([^<]+?)\\s*<\\/div>', 'i');
      const altMatch = desc.match(altPattern);
      if (altMatch) {
        const owner = altMatch[1].trim();
        if (owner && owner.length > 0 && !owner.includes('<') && !owner.includes('>')) {
          metadata.owner = owner;
          return;
        }
      }
      
      // Look for common owner names in the description
      const commonOwners = [
        'Cape Town Helicopters',
        'Private owner',
        'Sport Helicopters',
        'NAC Helicopters',
        'Draken International'
      ];
      
      for (const ownerName of commonOwners) {
        if (desc.toLowerCase().includes(ownerName.toLowerCase())) {
          metadata.owner = ownerName;
          return;
        }
      }
    }
    
    // Look for owner patterns in name field
    if (obj.name && typeof obj.name === 'string') {
      const ownerMatch = obj.name.match(/owner[:\s]*([^,\n]+)/i);
      if (ownerMatch) {
        metadata.owner = ownerMatch[1].trim();
        return;
      }
    }
    
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        findOwner(obj[key]);
      }
    }
  }
  
  findOwner(xml);
  
  return metadata;
}

// Download OSM tile and convert to base64
async function downloadTileAsBase64(url) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: 5000
    });
    
    const base64 = Buffer.from(response.data).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.log(`⚠️ Failed to download tile: ${url}`);
    return null;
  }
}

// Web Mercator projection functions (same as Leaflet uses)
function latLonToWebMercator(lat, lon) {
  const x = (lon + 180) / 360;
  const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2;
  return { x, y };
}

function webMercatorToPixel(mercatorX, mercatorY, zoom, tileSize = 256) {
  const scale = Math.pow(2, zoom) * tileSize;
  return {
    x: mercatorX * scale,
    y: mercatorY * scale
  };
}

function calculateMapBounds(coordinates, tmnpCoords) {
  // Focus on flight coordinates for bounds calculation
  const flightCoords = coordinates.map(c => ({ lat: c.lat, lon: c.lon }));
  
  if (flightCoords.length === 0) return null;
  
  // Get TMNP bounds as baseline
  let tmnpMinLat = -34.5, tmnpMaxLat = -33.7;
  let tmnpMinLon = 18.2, tmnpMaxLon = 18.6;
  
  if (tmnpCoords && tmnpCoords.length > 0) {
    tmnpMinLat = Math.min(...tmnpCoords.flatMap(p => p.outer.map(([lon, lat]) => lat)));
    tmnpMaxLat = Math.max(...tmnpCoords.flatMap(p => p.outer.map(([lon, lat]) => lat)));
    tmnpMinLon = Math.min(...tmnpCoords.flatMap(p => p.outer.map(([lon, lat]) => lon)));
    tmnpMaxLon = Math.max(...tmnpCoords.flatMap(p => p.outer.map(([lon, lat]) => lon)));
  }
  
  // Find flight bounds
  let minLat = flightCoords[0].lat;
  let maxLat = flightCoords[0].lat;
  let minLon = flightCoords[0].lon;
  let maxLon = flightCoords[0].lon;
  
  for (const coord of flightCoords) {
    if (coord.lat < minLat) minLat = coord.lat;
    if (coord.lat > maxLat) maxLat = coord.lat;
    if (coord.lon < minLon) minLon = coord.lon;
    if (coord.lon > maxLon) maxLon = coord.lon;
  }
  
  // Use intelligent bounds: focus on TMNP area but include flight path
  // If flight extends far beyond TMNP, limit the bounds to keep TMNP visible
  const tmnpLatRange = tmnpMaxLat - tmnpMinLat;
  const tmnpLonRange = tmnpMaxLon - tmnpMinLon;
  
  // Use TMNP as center, but extend to include flight with reasonable limits
  const finalMinLat = Math.max(minLat, tmnpMinLat - tmnpLatRange * 0.5);
  const finalMaxLat = Math.min(maxLat, tmnpMaxLat + tmnpLatRange * 0.5);
  const finalMinLon = Math.max(minLon, tmnpMinLon - tmnpLonRange * 0.5);
  const finalMaxLon = Math.min(maxLon, tmnpMaxLon + tmnpLonRange * 0.5);
  
  // Add 5% padding to final bounds
  const latPadding = (finalMaxLat - finalMinLat) * 0.05;
  const lonPadding = (finalMaxLon - finalMinLon) * 0.05;
  
  return { 
    minLat: finalMinLat - latPadding, 
    maxLat: finalMaxLat + latPadding, 
    minLon: finalMinLon - lonPadding, 
    maxLon: finalMaxLon + lonPadding 
  };
}

function calculateZoomLevel(bounds, width, height) {
  const latDiff = bounds.maxLat - bounds.minLat;
  const lonDiff = bounds.maxLon - bounds.minLon;
  
  // Calculate zoom based on bounds (mimicking Leaflet's fitBounds)
  let zoom = 1;
  for (let z = 1; z <= 18; z++) {
    const scale = Math.pow(2, z) * 256;
    const projectedLatDiff = (latDiff / 360) * scale;
    const projectedLonDiff = (lonDiff / 360) * scale;
    
    // Back to 80% for better fit that doesn't clip
    if (projectedLatDiff < height * 0.8 && projectedLonDiff < width * 0.8) {
      zoom = z;
    } else {
      break;
    }
  }
  
  // Remove the +1 zoom boost, just use calculated zoom with reasonable bounds
  return Math.max(11, Math.min(zoom, 16));
}

async function generateSquareMapSVG(coordinates, tmnpCoords, bounds, zoom, metadata) {
  const size = 800; // Square format
  
  // Calculate center point
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;
  
  // Convert bounds to Web Mercator
  const topLeft = latLonToWebMercator(bounds.maxLat, bounds.minLon);
  const bottomRight = latLonToWebMercator(bounds.minLat, bounds.maxLon);
  
  // Convert to pixel coordinates
  const topLeftPixel = webMercatorToPixel(topLeft.x, topLeft.y, zoom);
  const bottomRightPixel = webMercatorToPixel(bottomRight.x, bottomRight.y, zoom);
  
  // Calculate offset to center the map in square format
  const mapWidth = bottomRightPixel.x - topLeftPixel.x;
  const mapHeight = bottomRightPixel.y - topLeftPixel.y;
  const maxDimension = Math.max(mapWidth, mapHeight);
  
  // Create square area around the center with enough tiles to fill it
  const centerPixel = webMercatorToPixel(
    latLonToWebMercator(centerLat, centerLon).x,
    latLonToWebMercator(centerLat, centerLon).y,
    zoom
  );
  
  const halfSize = maxDimension / 2 + 128; // Add buffer for tile boundaries
  const squareTopLeft = {
    x: centerPixel.x - halfSize,
    y: centerPixel.y - halfSize
  };
  const squareBottomRight = {
    x: centerPixel.x + halfSize,
    y: centerPixel.y + halfSize
  };
  
  // Calculate which tiles we need for the square area
  const topLeftTile = {
    x: Math.floor(squareTopLeft.x / 256),
    y: Math.floor(squareTopLeft.y / 256)
  };
  const bottomRightTile = {
    x: Math.floor(squareBottomRight.x / 256),
    y: Math.floor(squareBottomRight.y / 256)
  };
  
  console.log(`📊 Downloading tiles for ${bottomRightTile.x - topLeftTile.x + 1}x${bottomRightTile.y - topLeftTile.y + 1} grid`);
  
  // Download all tiles and convert to base64
  const tilePromises = [];
  for (let x = topLeftTile.x; x <= bottomRightTile.x; x++) {
    for (let y = topLeftTile.y; y <= bottomRightTile.y; y++) {
      const url = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
      tilePromises.push(downloadTileAsBase64(url));
    }
  }
  
  const tiles = await Promise.all(tilePromises);
  console.log(`🗺️ Downloaded ${tiles.filter(t => t).length} tiles successfully`);
  
  // Create coordinate transformation function
  const coordToPixel = (lat, lon) => {
    const webMercator = latLonToWebMercator(lat, lon);
    const pixel = webMercatorToPixel(webMercator.x, webMercator.y, zoom);
    
    // Convert to SVG coordinates (centered in square)
    const offsetX = (size - mapWidth) / 2;
    const offsetY = (size - mapHeight) / 2;
    
    return {
      x: pixel.x - topLeftPixel.x + offsetX,
      y: pixel.y - topLeftPixel.y + offsetY
    };
  };
  
  // Find violation points
  const violations = findViolationPoints(coordinates, tmnpCoords);
  console.log(`🚨 Found ${violations.length} violation points`);
  
  // Cluster nearby violations
  const violationClusters = clusterViolations(violations, coordToPixel);
  console.log(`📍 Clustered into ${violationClusters.length} violation markers`);

  // Load and convert warning PNG to base64
  function loadWarningPNG() {
    const warningPath = path.join(__dirname, '..', 'public', 'warning.png');
    
    if (!fs.existsSync(warningPath)) {
      console.log('⚠️ Warning PNG not found at:', warningPath);
      console.log('⚠️ Please ensure warning.png is in the /public folder');
      return null;
    }
    
    try {
      const pngBuffer = fs.readFileSync(warningPath);
      const base64 = pngBuffer.toString('base64');
      console.log('✅ Loaded warning PNG icon');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.log('❌ Error loading warning PNG:', error.message);
      return null;
    }
  }
  
  // Project TMNP boundary to pixel coordinates
  const tmnpElements = [];
  if (tmnpCoords && tmnpCoords.length > 0) {
    for (const polygon of tmnpCoords) {
      // Create outer boundary path
      const outerPath = polygon.outer.map(([lon, lat]) => {
        const pixel = coordToPixel(lat, lon);
        return `${pixel.x},${pixel.y}`;
      }).join(' ');
      
      if (outerPath) {
        tmnpElements.push(`<polygon points="${outerPath}" class="tmnp-boundary"/>`);
      }
      
      // Create inner boundary paths (holes) - these should be filled differently
      for (const innerRing of polygon.inner) {
        const innerPath = innerRing.map(([lon, lat]) => {
          const pixel = coordToPixel(lat, lon);
          return `${pixel.x},${pixel.y}`;
        }).join(' ');
        
        if (innerPath) {
          tmnpElements.push(`<polygon points="${innerPath}" class="tmnp-hole"/>`);
        }
      }
    }
  }
  
  // Project flight path to pixel coordinates
  const flightPath = coordinates.map(coord => {
    const pixel = coordToPixel(coord.lat, coord.lon);
    return `${pixel.x},${pixel.y}`;
  }).join(' ');
  
  // Create start and end markers
  const startPoint = coordToPixel(coordinates[0].lat, coordinates[0].lon);
  const endPoint = coordToPixel(coordinates[coordinates.length - 1].lat, coordinates[coordinates.length - 1].lon);
  
  // Generate OSM tile elements with embedded base64 data
  const tileElements = [];
  let tileIndex = 0;
  for (let x = topLeftTile.x; x <= bottomRightTile.x; x++) {
    for (let y = topLeftTile.y; y <= bottomRightTile.y; y++) {
      const tile = tiles[tileIndex++];
      if (tile) {
        const pixelX = (x * 256) - topLeftPixel.x + (size - mapWidth) / 2;
        const pixelY = (y * 256) - topLeftPixel.y + (size - mapHeight) / 2;
        tileElements.push(`<image href="${tile}" x="${pixelX}" y="${pixelY}" width="256" height="256" opacity="1.0"/>`);
      }
    }
  }
  
  // Create violation markers with improved error handling
  const violationMarkers = violationClusters.map((cluster, index) => {
    // Use the first point in the cluster as the marker position
    const representative = cluster[0];
    const pixel = coordToPixel(representative.lat, representative.lon);
    
    // Validate pixel coordinates
    if (isNaN(pixel.x) || isNaN(pixel.y)) {
      console.log(`⚠️ Invalid pixel coordinates for violation ${index + 1}, skipping`);
      return '';
    }
    
    // Load the user's warning PNG
    const warningPNG = loadWarningPNG();
    
    if (!warningPNG) {
      console.log('⚠️ Warning PNG not available, skipping violation marker');
      return '';
    }
    
    // Use the user's PNG image with proper XML escaping
    const size = 24; // Size for the warning icon
    const x = Math.round(pixel.x - size/2);
    const y = Math.round(pixel.y - size/2);
    const shadowX = Math.round(pixel.x - size/2 + 1);
    const shadowY = Math.round(pixel.y - size/2 + 1);
    
    return `    <g class="violation-marker">
      <!-- Drop shadow -->
      <image href="${warningPNG}" x="${shadowX}" y="${shadowY}" width="${size}" height="${size}" opacity="0.3"/>
      <!-- Warning PNG icon -->
      <image href="${warningPNG}" x="${x}" y="${y}" width="${size}" height="${size}"/>
    </g>`;
  }).filter(marker => marker !== '').join('\n');
  
  // Create simplified text with proper XML escaping
  const ownerText = metadata.owner !== 'Unknown Owner' ? ` (${metadata.owner})` : '';
  const cleanOwner = ownerText.replace(/[<>&"']/g, ''); // Remove problematic characters
  const line1 = `Flight taken on ${metadata.date}, by ${metadata.registration}${cleanOwner}.`;
  const line2 = `Restricted airspace (NP17) shown in red.`;
  
  // Validate and clean up SVG content
  const cleanSVGContent = (content) => {
    return content
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  };
  
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <style>
      .tmnp-boundary { fill: rgba(255, 0, 0, 0.25); stroke: #ff0000; stroke-width: 3; stroke-opacity: 0.7; }
      .tmnp-hole { fill: rgba(255, 255, 255, 1.0); stroke: #ff0000; stroke-width: 2; stroke-opacity: 0.7; }
      .flight-path { fill: none; stroke: #0000ff; stroke-width: 4; stroke-opacity: 0.8; }
      .start-marker { fill: #00ff00; stroke: #000; stroke-width: 2; }
      .end-marker { fill: #ff0000; stroke: #000; stroke-width: 2; }
      .caption { font-family: Arial, sans-serif; font-size: 14px; fill: #000; font-weight: bold; }
      .caption-bg { fill: rgba(255, 255, 255, 0.9); stroke: #000; stroke-width: 1; }
    </style>
  </defs>
  
  <!-- OSM Tile Background -->
  ${cleanSVGContent(tileElements.join('\n  '))}
  
  <!-- TMNP Boundary -->
  ${cleanSVGContent(tmnpElements.join('\n'))}
  
  <!-- Flight Path -->
  <polyline points="${flightPath}" class="flight-path"/>
  
  <!-- Start Marker -->
  <circle cx="${Math.round(startPoint.x)}" cy="${Math.round(startPoint.y)}" r="6" class="start-marker"/>
  
  <!-- End Marker -->
  <circle cx="${Math.round(endPoint.x)}" cy="${Math.round(endPoint.y)}" r="6" class="end-marker"/>
  
  <!-- Caption Box -->
  <rect x="10" y="${size - 70}" width="${size - 20}" height="60" class="caption-bg" rx="5"/>
  <text x="20" y="${size - 50}" class="caption">
    <tspan x="20" dy="0">${line1}</tspan>
    <tspan x="20" dy="18">${line2}</tspan>
  </text>
  
  <!-- Violation Markers -->
${violationMarkers}
</svg>`;

  return svgContent;
}

// Convert SVG to PNG using Sharp
async function convertSVGToPNG(svgContent, outputPath) {
  try {
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .png()
      .toBuffer();
    
    fs.writeFileSync(outputPath, pngBuffer);
    return outputPath;
  } catch (error) {
    console.log('❌ Error converting to PNG:', error.message);
    // Fallback: save as SVG
    const svgPath = outputPath.replace('.png', '.svg');
    fs.writeFileSync(svgPath, svgContent);
    return svgPath;
  }
}

// Simple test script to generate one flight map image
async function generateFlightImage(kmlFilename) {
  const kmlPath = path.join(__dirname, 'uploads', kmlFilename);
  
  if (!fs.existsSync(kmlPath)) {
    console.log(`❌ KML file not found: ${kmlFilename}`);
    return false;
  }

  try {
    console.log(`🚁 Processing ${kmlFilename}...`);
    
    // Load TMNP boundary
    const tmnpCoords = loadTMNPCoordinates();
    
    // Parse KML to extract coordinates
    const xmlData = fs.readFileSync(kmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false });
    const xml = parser.parse(xmlData);
    
    // Extract coordinate points from KML
    const coordinates = extractCoordinates(xml);
    
    if (coordinates.length === 0) {
      console.log('❌ No coordinates found in KML file');
      return false;
    }

    console.log(`📍 Found ${coordinates.length} coordinate points`);
    
    // Extract flight metadata
    const metadata = extractFlightMetadata(kmlFilename, xml);
    console.log(`📝 Flight metadata:`, metadata);
    
    // Calculate bounds including TMNP area
    const bounds = calculateMapBounds(coordinates, tmnpCoords);
    console.log('📐 Bounds:', bounds);
    
    // Calculate appropriate zoom level
    const zoom = calculateZoomLevel(bounds, 800, 800);
    console.log(`🔍 Using zoom level: ${zoom}`);
    
    // Generate square SVG map (this will download tiles)
    const svgContent = await generateSquareMapSVG(coordinates, tmnpCoords, bounds, zoom, metadata);
    
    // Create flight-maps directory if it doesn't exist
    const mapsDir = path.join(__dirname, 'flight-maps');
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir);
    }
    
    // Save as PNG
    const baseName = path.basename(kmlFilename, '.kml');
    const pngPath = path.join(mapsDir, `${baseName}.png`);
    
    const savedPath = await convertSVGToPNG(svgContent, pngPath);
    console.log(`✅ Flight map saved: ${savedPath}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Error generating flight image:', error.message);
    return false;
  }
}

function extractCoordinates(xml) {
  const coordinates = [];
  
  // Try to find coordinates in various KML structures
  function findCoordinates(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    // Handle gx:coord elements (format: "longitude latitude altitude")
    if (obj['gx:coord']) {
      const coordElements = Array.isArray(obj['gx:coord']) ? obj['gx:coord'] : [obj['gx:coord']];
      
      for (const coordStr of coordElements) {
        if (typeof coordStr === 'string') {
          const parts = coordStr.trim().split(/\s+/);
          if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lon)) {
              coordinates.push({ lat, lon });
            }
          }
        }
      }
    }
    
    // Handle regular coordinates element (format: "longitude,latitude,altitude")
    if (obj.coordinates) {
      const coordStr = typeof obj.coordinates === 'string' ? obj.coordinates : obj.coordinates.toString();
      const coordLines = coordStr.trim().split(/\s+/);
      
      for (const line of coordLines) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const lon = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            coordinates.push({ lat, lon });
          }
        }
      }
    }
    
    // Recursively search in all object properties
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        findCoordinates(obj[key]);
      }
    }
  }
  
  findCoordinates(xml);
  return coordinates;
}

// Point-in-polygon detection using ray casting algorithm
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// Check if a point is inside TMNP (considering holes)
function pointInTMNP(lat, lon, tmnpPolygons) {
  if (!tmnpPolygons || tmnpPolygons.length === 0) return false;
  
  for (const polygon of tmnpPolygons) {
    // Check if point is in outer boundary
    const inOuter = pointInPolygon([lon, lat], polygon.outer);
    
    if (inOuter) {
      // Check if point is in any holes (inner boundaries)
      let inHole = false;
      for (const hole of polygon.inner) {
        if (pointInPolygon([lon, lat], hole)) {
          inHole = true;
          break;
}
      }
      
      // If in outer boundary but not in any hole, it's inside TMNP
      if (!inHole) {
        return true;
      }
    }
  }
  
  return false;
}

// Find violation points where flight path enters restricted airspace
function findViolationPoints(coordinates, tmnpPolygons) {
  const violations = [];
  let wasInside = false;
  
  for (let i = 0; i < coordinates.length; i++) {
    const coord = coordinates[i];
    const isInside = pointInTMNP(coord.lat, coord.lon, tmnpPolygons);
    
    // If we entered restricted airspace (outside -> inside)
    if (!wasInside && isInside) {
      violations.push({
        lat: coord.lat,
        lon: coord.lon,
        index: i
      });
    }
    
    wasInside = isInside;
  }
  
  return violations;
}

// Cluster nearby violation points to reduce clutter
function clusterViolations(violations, coordToPixel, maxDistance = 50) {
  if (violations.length === 0) return [];
  
  const clusters = [];
  const used = new Set();
  
  for (let i = 0; i < violations.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = [violations[i]];
    used.add(i);
    
    const basePixel = coordToPixel(violations[i].lat, violations[i].lon);
    
    // Find nearby violations to cluster
    for (let j = i + 1; j < violations.length; j++) {
      if (used.has(j)) continue;
      
      const comparePixel = coordToPixel(violations[j].lat, violations[j].lon);
      const distance = Math.sqrt(
        Math.pow(basePixel.x - comparePixel.x, 2) + 
        Math.pow(basePixel.y - comparePixel.y, 2)
      );
      
      if (distance <= maxDistance) {
        cluster.push(violations[j]);
        used.add(j);
      }
    }
    
    clusters.push(cluster);
  }
  
  return clusters;
}

// If no specific KML file provided, process all KML files
async function processAllFiles() {
  console.log('Processing ALL KML files...');
  
  // Define directories
  const uploadsDir = path.join(__dirname, 'uploads');
  const outputDir = path.join(__dirname, 'flight-maps');
  
  const kmlFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.kml'));
  console.log(`📁 Found ${kmlFiles.length} KML files to check`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const startTime = Date.now();

  for (const filename of kmlFiles) {
    try {
      // Check if PNG already exists
      const pngFilename = filename.replace('.kml', '.png');
      const pngPath = path.join(outputDir, pngFilename);
      
      if (fs.existsSync(pngPath)) {
        skipped++;
        if (skipped % 50 === 0) {
          console.log(`⏭️  Skipped ${skipped} existing files...`);
        }
        continue;
      }
      
      processed++;
      const kmlPath = path.join(uploadsDir, filename);
      
      if (processed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processed / elapsed;
        const remaining = kmlFiles.length - processed - skipped;
        const eta = remaining / rate;
        console.log(`🔄 Processed ${processed}, skipped ${skipped}, remaining ${remaining} (${rate.toFixed(1)}/s, ETA: ${Math.round(eta)}s)`);
      }
      
      await generateFlightImage(filename);
    } catch (error) {
      errors++;
      console.error(`❌ Error processing ${filename}:`, error.message);
    }
  }

  console.log(`✅ Bulk processing complete!`);
  console.log(`📊 Results: ${processed} generated, ${skipped} skipped, ${errors} errors`);
  console.log(`⏱️  Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

processAllFiles().catch(console.error); 