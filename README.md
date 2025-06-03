# 🚁 TMNP Helicopter Tracking System

A comprehensive web application for monitoring and analyzing helicopter flights that violate Table Mountain National Park (TMNP) restricted airspace in Cape Town, South Africa.

## 📋 Table of Contents
- [Overview](#overview)
- [Why This Project Exists](#why-this-project-exists)
- [Quick Start](#quick-start)
- [Performance Highlights](#performance-highlights)
- [Project Structure](#project-structure)
- [Data Structure](#data-structure)
- [Adding New Flight Data](#adding-new-flight-data)
- [API Endpoints](#api-endpoints)
- [Technical Details](#technical-details)
- [Tracked Helicopters](#tracked-helicopters)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

This system tracks helicopter flights that enter restricted airspace around Table Mountain National Park. It processes KML flight data from sources like FlightRadar24 and ADS-B Exchange, automatically detects airspace violations, and generates detailed flight map visualizations with violation markers.

### Key Features
- **⚡ Ultra-Fast Startup**: Server loads in 8 seconds (down from minutes) using pre-generated metadata
- **🚀 Optimized Deployments**: Deploy in 2-3 minutes (down from 8-12 minutes) with smart caching
- **📊 Comprehensive Analytics**: 422 flights, 1128.39 MB of data, file sizes 0.46-2.16+ MB
- **🔄 Automated KML Processing**: Rename improperly formatted files and extract metadata
- **🎯 Airspace Violation Detection**: Identify flights that enter TMNP restricted zones
- **🗺️ Flight Map Generation**: Create detailed PNG maps with OSM backgrounds, flight paths, and violation markers
- **💻 Interactive Web Interface**: Browse flights with filtering, search, and detailed views
- **📋 Report Generation**: Generate violation reports with maps for regulatory purposes
- **✅ Data Validation**: Ensure data quality by removing false positives

## 🌍 Why This Project Exists

Table Mountain National Park has restricted airspace to protect wildlife and ensure visitor safety. However, helicopter operators sometimes violate these restrictions, either accidentally or intentionally. This system:

1. **Monitors Compliance**: Provides objective evidence of airspace violations
2. **Supports Enforcement**: Generates reports for regulatory bodies like SACAA
3. **Improves Safety**: Helps identify problematic flight patterns
4. **Protects Wildlife**: Reduces helicopter noise pollution in sensitive areas
5. **Provides Transparency**: Offers public visibility into airspace violations

The data helps aviation authorities, park management, and concerned citizens understand the scope of violations and take appropriate action.

## 🚀 Quick Start

### Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Generate master metadata for ultra-fast server startup:**
   ```bash
   node generate-master-metadata.cjs
   ```
   *This processes all 423 KML files once and creates optimized metadata for instant loading*

3. **Start the development servers:**
   ```bash
   npm run dev:all
   ```
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000

4. **Or start production server:**
   ```bash
   npm run build  # Build frontend first
   npm start      # Serves everything on http://localhost:4000
   ```

### Adding New KML Files - Optimized Workflow

1. **Drop KML files** into `server/uploads/`

2. **Process new files (one command does everything):**
   ```bash
   node process-new-kmls.cjs
   ```
   This script will:
   - ✅ Rename files to proper format (YYYY-MM-DD-REGISTRATION-ID.kml)
   - 🖼️ Generate PNG flight path images
   - 📝 **Update master metadata incrementally** (only processes new files)
   - 🗑️ Clear server cache
   - ⚡ Ensure fast server startup

3. **Commit changes to git:**
   ```bash
   git add .
   git commit -m "Add new helicopter flights"
   git push
   ```

4. **Deploy automatically** - Render will build and deploy in 2-3 minutes

## ⚡ Performance Highlights

### 🚀 Server Startup Performance
- **Before**: Scanned 423 KML files individually on every startup (MINUTES)
- **After**: Reads one pre-generated 105KB JSON file (8 SECONDS)
- **Improvement**: 2000% faster startup time

### 🎯 Deployment Performance  
- **Before**: Regenerated all metadata on every deploy (8-12 minutes)
- **After**: Uses committed metadata file, only builds frontend (2-3 minutes)
- **Improvement**: 80% faster deployments

### 📊 Data Processing Performance
- **Smart Incremental Updates**: Only processes new files, not entire dataset
- **Pre-calculated File Sizes**: No dynamic file fetching on frontend
- **Optimized Metadata**: All flight data pre-processed and cached

### 💾 Current Dataset Stats
- **Total Files**: 423 KML files
- **Valid Flights**: 422 (1 excluded for missing registration)
- **Total Size**: 1128.39 MB
- **Average File Size**: 2.67 MB
- **Size Range**: 0.46 MB - 2.16+ MB per file

## 📂 Project Structure

```
heli-map/
├── README.md                          # This file
├── process-new-kmls.cjs              # ⭐ Main script for processing new KML files
├── generate-master-metadata.cjs      # ⭐ Generates optimized metadata for fast startup
├── package.json                       # Node.js dependencies
├── vite.config.js                    # Frontend build configuration
├── index.html                        # Main HTML entry point
├── src/                              # Frontend React application
│   ├── App.jsx                       # Main React component
│   └── App.css                       # Styles
├── server/                           # Backend Node.js application
│   ├── index.cjs                     # ⭐ Express server (optimized for fast startup)
│   ├── master-metadata.json          # ⭐ Pre-generated flight metadata (105KB)
│   ├── uploads/                      # KML flight data files (423 files, 1.1GB)
│   ├── flight-maps/                  # Generated PNG flight maps
│   ├── generate-flight-image.cjs     # PNG map generation script
│   ├── check-zero-violations.cjs     # Data validation utility
│   └── remove-deleted-flights.cjs    # Cleanup utility
├── public/                           # Static assets
│   ├── tmnp.kml                      # TMNP boundary definition
│   └── flight-images/                # Public PNG flight maps (symlink)
└── scripts/                          # Utility scripts
    └── deploy-check.js               # Deployment validation
```

**⭐ = Performance-critical files**

## 📊 Data Structure

### Master Metadata System
The system now uses a pre-generated metadata file (`server/master-metadata.json`) containing:
```json
{
  "flights": [
    {
      "filename": "2025-06-01-ZS-RTG-3a9862ef.kml",
      "registration": "ZS-RTG",
      "date": "2025-06-01", 
      "time": "07:53",
      "owner": "Cape Town Helicopters",
      "imageUrl": "https://cdn.jetphotos.com/200/5/541479_1728643363_tb.jpg?v=0",
      "fileSizeMB": 1.23
    }
  ],
  "generatedAt": "2025-01-23T10:30:00.000Z",
  "totalFlights": 422,
  "totalSizeMB": 1128.39
}
```

### KML Files
Flight data is stored as KML files with a standardized naming convention:
```
YYYY-MM-DD-REGISTRATION-HASH.kml
```
Examples:
- `2025-06-01-ZS-RTG-3a9862ef.kml` (Cape Town Helicopters)
- `2025-05-25-ZT-REG-3a7dc922.kml` (Private owner)

### Flight Metadata
Each flight includes:
- **Date/Time**: When the flight occurred
- **Registration**: Aircraft registration (e.g., ZS-RTG, ZT-REG)
- **Owner**: Operator name (Cape Town Helicopters, Private owner, etc.)
- **Source**: Data source (FlightRadar24, ADS-B Exchange)
- **File Size**: Pre-calculated size in MB (0.46-2.16+ MB range)
- **Image URL**: Aircraft photo from JetPhotos
- **Coordinates**: GPS tracking points throughout the flight
- **Violations**: Points where aircraft entered restricted airspace

### Generated Maps
Each KML file has a corresponding PNG flight map showing:
- **OpenStreetMap Background**: Detailed terrain and landmarks
- **TMNP Boundaries**: Red restricted airspace zones
- **Flight Path**: Blue line showing aircraft route
- **Violation Markers**: Red warning icons at violation points
- **Metadata**: Aircraft registration, date, and owner information

## ➕ Adding New Flight Data

### Optimized Workflow (Recommended)
```bash
# 1. Add KML files to server/uploads/
# 2. Process everything with one command:
node process-new-kmls.cjs

# 3. Commit and deploy:
git add .
git commit -m "Add new helicopter flights"  
git push
```

**What happens automatically:**
- ✅ File renaming and metadata extraction
- 🖼️ PNG map generation  
- 📝 Master metadata update (incremental)
- 🗑️ Cache clearing
- ⚡ Ready for ultra-fast server startup

### Manual Metadata Regeneration
If you need to regenerate all metadata from scratch:
```bash
node generate-master-metadata.cjs
```

**When to run this:**
- After major changes to KML processing logic
- If master metadata becomes corrupted
- Before major deployments (optional)

### Data Sources
The system accepts KML files from:
- **FlightRadar24**: Commercial flight tracking (most common)
- **ADS-B Exchange**: Open source aircraft tracking
- **Manual Imports**: Custom KML files with proper format

### File Format Requirements
KML files must contain:
- Aircraft registration in name field or placemark name
- Timestamp data in `<when>` elements or placemark names
- Coordinate data in `<coordinates>` or `<gx:coord>` elements

## 🔌 API Endpoints

### Flight Data
- `GET /api/flights` - Get all flight metadata (loads from master-metadata.json)
- `GET /api/flights/:id` - Get specific flight details

### File Serving  
- `GET /flight-maps/:filename` - Serve PNG flight maps
- `GET /uploads/:filename` - Serve KML files (restricted)

### Static Assets
- `GET /tmnp.kml` - TMNP boundary definition

## 🔧 Technical Details

### Performance Architecture
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   KML Files     │ -> │ Master Metadata  │ -> │ Ultra-Fast      │
│   (423 files    │    │ Generator        │    │ Server Startup  │
│    1.1GB)       │    │ (runs locally)   │    │ (8 seconds)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Backend (Node.js/Express)
- **🚀 Fast Startup**: Loads pre-generated metadata instead of scanning files
- **📝 Smart Processing**: Incremental updates for new files only  
- **🗺️ Map Generation**: SVG to PNG conversion with OpenStreetMap tiles
- **💾 Intelligent Caching**: Metadata cached locally and in git
- **🔍 Geospatial Analysis**: Point-in-polygon detection for airspace violations

### Frontend (React/Vite)
- **📱 Responsive Design**: Works on desktop and mobile devices
- **🔄 Real-time Updates**: Automatic refresh when new data is added
- **🗺️ Interactive Maps**: Click to view detailed flight information
- **📊 File Size Display**: Pre-calculated sizes shown instantly
- **📥 Export Features**: Download reports and flight maps

### Key Technologies
- **Node.js**: Backend runtime
- **Express**: Web server framework  
- **React**: Frontend user interface
- **Vite**: Frontend build tool
- **Sharp**: Image processing for PNG generation
- **fast-xml-parser**: KML file parsing
- **Turf.js**: Geospatial calculations

### Performance Optimizations
- **⚡ Master Metadata**: Pre-generated JSON file for instant loading
- **📈 Incremental Processing**: Only handle new files, not entire dataset
- **💾 Git-based Caching**: Metadata committed to repository
- **🖼️ Lazy Loading**: Load flight maps on demand
- **🗺️ Tile Caching**: Cache OpenStreetMap tiles locally
- **📦 Batch Processing**: Efficient handling of large datasets

## 🚁 Tracked Helicopters

Below is a list of helicopters for which we have found flight tracks. There are undoubtedly more helicopters operating in the Cape Town area that we have not yet captured data for.

**⚠️ Data Accuracy Disclaimer**: The owner information listed below may contain errors and cannot be guaranteed to be completely accurate. This information was compiled from various sources including social media, company promotional pages, and third-party databases. If you notice any inaccuracies, please report them through GitHub issues.

| **Registration** | **Owner/Operator** | **Tracked Flights** | **Data Size** |
|------------------|-------------------|---------------------|---------------|
| **ZS-HBO** | Cape Town Helicopters | 72 flights | ~192 MB |
| **ZS-HIE** | Cape Town Helicopters | 74 flights | ~197 MB |
| **ZS-HIM** | Cape Town Helicopters | 33 flights | ~88 MB |
| **ZS-HMB** | Sport Helicopters | 12 flights | ~32 MB |
| **ZS-RTG** | Cape Town Helicopters | 85 flights | ~227 MB |
| **ZT-HOT** | Cape Town Helicopters | 69 flights | ~184 MB |
| **ZT-REG** | NAC | 65 flights | ~174 MB |
| **ZT-RMS** | Cape Town Helicopters | 7 flights | ~19 MB |

### Fleet Summary by Operator
- **Cape Town Helicopters**: 6 aircraft (ZS-HBO, ZS-HIE, ZS-HIM, ZS-RTG, ZT-HOT, ZT-RMS) - 340 flights (~907 MB)
- **NAC**: 1 aircraft (ZT-REG) - 65 flights (~174 MB)  
- **Sport Helicopters**: 1 aircraft (ZS-HMB) - 12 flights (~32 MB)

**Total Dataset**: 422 valid flights, 1128.39 MB, average 2.67 MB per file

*Note: This represents only helicopters with recorded airspace violations. Many more helicopters operate legally in the Cape Town area without entering restricted airspace.*

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. **Run performance tests**: Ensure fast startup still works
5. **Update master metadata**: Run `node generate-master-metadata.cjs` if needed
6. Test thoroughly with real data
7. Commit with descriptive messages
8. Push to your fork: `git push origin feature/new-feature`
9. Create a Pull Request

### Areas for Contribution
- **🚀 Performance**: Further optimize startup and processing times
- **📊 Data Analysis**: Advanced violation pattern detection
- **🗺️ Visualizations**: Enhanced map generation features
- **📱 Mobile**: Improve mobile interface
- **🔌 Integrations**: Add support for additional flight tracking APIs
- **📝 Documentation**: Expand documentation and tutorials
- **🧪 Testing**: Add automated tests for reliability

### Code Style
- Use descriptive variable names
- Comment complex geospatial calculations  
- Follow existing file organization patterns
- **Performance-conscious**: Consider impact on startup time
- Test with real KML data before submitting

## 📈 Future Enhancements

### Planned Features
- **📡 Real-time Monitoring**: Live flight tracking integration
- **🔔 Alert System**: Notifications for new violations
- **📊 Historical Analysis**: Trend analysis and reporting
- **📱 Mobile App**: Native mobile application
- **🔌 API Expansion**: Public API for third-party integrations
- **☁️ Cloud Storage**: Offload large KML files to cloud storage

### Performance Roadmap
- **⚡ Sub-second Startup**: Target under 1 second server startup
- **🔄 Real-time Updates**: WebSocket-based live updates
- **📦 Incremental Deployments**: Only deploy changed files
- **🗄️ Database Migration**: Move from JSON to proper database
- **🌐 CDN Integration**: Serve static assets from CDN

### Research Applications
- **🦅 Wildlife Impact Studies**: Correlate flights with wildlife behavior
- **🔊 Noise Pollution Analysis**: Map noise impact zones
- **📅 Seasonal Patterns**: Identify peak violation periods
- **🏢 Operator Analysis**: Track compliance by helicopter company

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- **South African Civil Aviation Authority (SACAA)**: Aviation regulations and oversight
- **Table Mountain National Park**: Protected area management
- **FlightRadar24 & ADS-B Exchange**: Flight tracking data sources
- **OpenStreetMap**: Map tile data for visualizations
- **Open Source Community**: Libraries and tools that made this possible

## 📞 Contact

For questions, suggestions, or collaboration opportunities:
- **GitHub Issues**: Report bugs or request features
- **Email**: [Contact through GitHub profile]
- **Project Repository**: https://github.com/werneravr/heli-map

---

*This project aims to promote aviation safety, wildlife protection, and regulatory compliance through transparent monitoring of helicopter operations around Table Mountain National Park.*
