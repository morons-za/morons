# 🚁 TMNP Helicopter Tracking System

A comprehensive web application for monitoring and analyzing helicopter flights that violate Table Mountain National Park (TMNP) restricted airspace in Cape Town, South Africa.

## 📋 Table of Contents
- [Overview](#overview)
- [Why This Project Exists](#why-this-project-exists)
- [Project Structure](#project-structure)
- [Data Structure](#data-structure)
- [Getting Started](#getting-started)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Adding New Flight Data](#adding-new-flight-data)
- [Technical Details](#technical-details)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

This system tracks helicopter flights that enter restricted airspace around Table Mountain National Park. It processes KML flight data from sources like FlightRadar24 and ADS-B Exchange, automatically detects airspace violations, and generates detailed flight map visualizations with violation markers.

### Key Features
- **Automated KML Processing**: Rename improperly formatted files and extract metadata
- **Airspace Violation Detection**: Identify flights that enter TMNP restricted zones
- **Flight Map Generation**: Create detailed PNG maps with OSM backgrounds, flight paths, and violation markers
- **Interactive Web Interface**: Browse flights with filtering, search, and detailed views
- **Report Generation**: Generate violation reports with maps for regulatory purposes
- **Data Validation**: Ensure data quality by removing false positives

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

2. **Generate master metadata for fast server startup:**
   ```bash
   node generate-master-metadata.cjs
   ```

3. **Start the development servers:**
   ```bash
   npm run dev:all
   ```
   This runs both frontend (http://localhost:5173) and backend (http://localhost:4000)

4. **Or start production server:**
   ```bash
   npm run build  # Build frontend first
   npm start      # Serves built app on http://localhost:4000
   ```

### Adding New KML Files

1. **Drop KML files** into `server/uploads/`

2. **Process new files:**
   ```bash
   node process-new-kmls.cjs
   ```
   This script will:
   - Rename files to proper format (YYYY-MM-DD-REGISTRATION-ID.kml)
   - Generate PNG flight path images
   - Clear server cache
   - **Regenerate master metadata for fast server startup**

3. **Restart server** to see new flights (if needed)

### Performance Notes

🚀 **Fast Startup**: The server now loads flight data from a pre-generated `server/master-metadata.json` file instead of scanning all KML files on startup. This reduces startup time from minutes to seconds.

- **Before**: Scanned 423 KML files individually (very slow)
- **After**: Reads one 105KB JSON file (extremely fast)

⚠️ **Important**: Always run `node process-new-kmls.cjs` after adding new KML files to regenerate the master metadata.

### Manual Metadata Regeneration

If you need to manually regenerate the master metadata:

```bash
node generate-master-metadata.cjs
```

This should be run:
- After adding new KML files
- Before deploying to production
- If helicopter metadata changes

## �� Project Structure

```
heli-map/
├── README.md                          # This file
├── process-new-kmls.cjs              # Main script for processing new KML files
├── package.json                       # Node.js dependencies
├── vite.config.js                    # Frontend build configuration
├── index.html                        # Main HTML entry point
├── src/                              # Frontend React application
│   ├── App.jsx                       # Main React component
│   └── App.css                       # Styles
├── server/                           # Backend Node.js application
│   ├── index.cjs                     # Express server and API
│   ├── uploads/                      # KML flight data files
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

## 📊 Data Structure

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
- **Coordinates**: GPS tracking points throughout the flight
- **Violations**: Points where aircraft entered restricted airspace

### Generated Maps
Each KML file has a corresponding PNG flight map showing:
- **OpenStreetMap Background**: Detailed terrain and landmarks
- **TMNP Boundaries**: Red restricted airspace zones
- **Flight Path**: Blue line showing aircraft route
- **Violation Markers**: Red warning icons at violation points
- **Metadata**: Aircraft registration, date, and owner information

### Current Dataset
- **418 Total Flights**: All with confirmed TMNP airspace violations
- **Date Range**: February 2025 - June 2025
- **98.6% Data Accuracy**: False positives removed through validation
- **100% File Parity**: Each KML has corresponding PNG map

## 🚁 Tracked Helicopters

Below is a list of helicopters for which we have found flight tracks. There are undoubtedly more helicopters operating in the Cape Town area that we have not yet captured data for.

**⚠️ Data Accuracy Disclaimer**: The owner information listed below may contain errors and cannot be guaranteed to be completely accurate. This information was compiled from various sources including social media, company promotional pages, and third-party databases. If you notice any inaccuracies, please report them through GitHub issues.

| **Registration** | **Owner/Operator** | **Tracked Flights** |
|------------------|-------------------|---------------------|
| **ZS-HBO** | Cape Town Helicopters | 72 flights |
| **ZS-HIE** | Cape Town Helicopters | 74 flights |
| **ZS-HIM** | Cape Town Helicopters | 33 flights |
| **ZS-HMB** | Sport Helicopters | 12 flights |
| **ZS-RTG** | Cape Town Helicopters | 85 flights |
| **ZT-HOT** | Cape Town Helicopters | 69 flights |
| **ZT-REG** | NAC | 65 flights |
| **ZT-RMS** | Cape Town Helicopters | 7 flights |

### Fleet Summary by Operator
- **Cape Town Helicopters**: 6 aircraft (ZS-HBO, ZS-HIE, ZS-HIM, ZS-RTG, ZT-HOT, ZT-RMS) - 340 flights
- **NAC**: 1 aircraft (ZT-REG) - 65 flights  
- **Sport Helicopters**: 1 aircraft (ZS-HMB) - 12 flights

*Note: This represents only helicopters with recorded airspace violations. Many more helicopters operate legally in the Cape Town area without entering restricted airspace.*

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/werneravr/heli-map.git
   cd heli-map
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Access the application**
   - Web interface: http://localhost:3000
   - API server: http://localhost:4000

### Environment Setup
The application runs in development mode by default. For production deployment, build the frontend:
```bash
npm run build
```

## 💻 Usage

### Web Interface
1. **Browse Flights**: View all flights in a sortable table
2. **Filter by Date**: Use date range picker to focus on specific periods
3. **Search**: Find flights by registration or owner
4. **View Details**: Click "View flight" to see detailed information
5. **Generate Reports**: Click "Generate Report" for violation summaries
6. **Download Maps**: Save flight map images for documentation

### Key Commands

#### Process New KML Files
When you add new KML files to `server/uploads/`, run:
```bash
node process-new-kmls.cjs
```
This single command:
- Detects improperly named files
- Extracts metadata and renames files correctly
- Generates PNG flight maps
- Clears cache for immediate web interface updates

#### Start the Application
```bash
npm start                    # Start both frontend and backend
```

#### Data Analysis
```bash
# Check for flights with zero violations (potential false positives)
node server/check-zero-violations.cjs

# Remove specific flights and their associated files
node server/remove-deleted-flights.cjs
```

#### File Counts
```bash
# Verify data integrity
ls server/uploads/*.kml | wc -l        # Count KML files
ls server/flight-maps/*.png | wc -l    # Count PNG files
```

## 🔌 API Endpoints

### Flight Data
- `GET /api/flights` - Get all flight metadata
- `GET /api/flights/:id` - Get specific flight details

### File Serving
- `GET /flight-maps/:filename` - Serve PNG flight maps
- `GET /uploads/:filename` - Serve KML files (restricted)

### Static Assets
- `GET /tmnp.kml` - TMNP boundary definition

## ➕ Adding New Flight Data

### Method 1: Manual Addition
1. Add KML files to `server/uploads/` directory
2. Run the processing script:
   ```bash
   node process-new-kmls.cjs
   ```

### Method 2: Smart KML Manager
The server includes an intelligent file manager that automatically:
- Detects new files on startup
- Processes them according to naming conventions
- Updates the cache and generates maps

### Data Sources
The system accepts KML files from:
- **FlightRadar24**: Commercial flight tracking
- **ADS-B Exchange**: Open source aircraft tracking
- **Manual Imports**: Custom KML files with proper format

### File Format Requirements
KML files must contain:
- Aircraft registration in name field
- Timestamp data in `<when>` elements or placemark names
- Coordinate data in `<coordinates>` or `<gx:coord>` elements

## 🔧 Technical Details

### Backend (Node.js/Express)
- **Smart File Processing**: Automatic KML parsing and metadata extraction
- **Geospatial Analysis**: Point-in-polygon detection for airspace violations
- **Map Generation**: SVG to PNG conversion with OpenStreetMap tiles
- **Caching**: Intelligent metadata caching for performance

### Frontend (React/Vite)
- **Responsive Design**: Works on desktop and mobile devices
- **Real-time Updates**: Automatic refresh when new data is added
- **Interactive Maps**: Click to view detailed flight information
- **Export Features**: Download reports and flight maps

### Key Technologies
- **Node.js**: Backend runtime
- **Express**: Web server framework
- **React**: Frontend user interface
- **Vite**: Frontend build tool
- **Sharp**: Image processing for PNG generation
- **Turf.js**: Geospatial calculations
- **fast-xml-parser**: KML file parsing

### Performance Optimizations
- **Metadata Caching**: Avoid re-processing unchanged files
- **Lazy Loading**: Load flight maps on demand
- **Tile Caching**: Cache OpenStreetMap tiles locally
- **Batch Processing**: Efficient handling of large datasets

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. Test thoroughly
5. Commit with descriptive messages
6. Push to your fork: `git push origin feature/new-feature`
7. Create a Pull Request

### Areas for Contribution
- **Data Sources**: Add support for additional flight tracking APIs
- **Visualizations**: Enhance map generation with new features
- **Analysis**: Implement advanced violation pattern detection
- **UI/UX**: Improve the web interface design
- **Documentation**: Expand documentation and tutorials
- **Testing**: Add automated tests for reliability

### Code Style
- Use descriptive variable names
- Comment complex geospatial calculations
- Follow existing file organization patterns
- Test with real KML data before submitting

## 📈 Future Enhancements

### Planned Features
- **Real-time Monitoring**: Live flight tracking integration
- **Alert System**: Notifications for new violations
- **Historical Analysis**: Trend analysis and reporting
- **Mobile App**: Native mobile application
- **API Expansion**: Public API for third-party integrations

### Research Applications
- **Wildlife Impact Studies**: Correlate flights with wildlife behavior
- **Noise Pollution Analysis**: Map noise impact zones
- **Seasonal Patterns**: Identify peak violation periods
- **Operator Analysis**: Track compliance by helicopter company

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
