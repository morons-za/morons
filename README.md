# 🚁 TMNP Helicopter Tracking System

A comprehensive system for monitoring and analyzing helicopter flights that violate Table Mountain National Park (TMNP) restricted airspace in Cape Town, South Africa. This project consists of a **static website** for public viewing and a **backend processing system** for data management and analysis.

## 📋 Table of Contents
- [Overview](#overview)
- [Why This Project Exists](#why-this-project-exists)
- [Architecture Overview](#architecture-overview)
- [Static Site](#static-site)
- [Backend System](#backend-system)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Data Processing Workflow](#data-processing-workflow)
- [Deployment](#deployment) - See also [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment system docs
- [Tracked Helicopters](#tracked-helicopters)
- [Contributing](#contributing)
- [License](#license)

## 🎯 Overview

This system tracks helicopter flights that enter restricted airspace around Table Mountain National Park. It processes KML flight data from sources like FlightRadar24 and ADS-B Exchange, automatically detects airspace violations, and generates detailed flight map visualizations with violation markers.

### Key Features
- **🗺️ Interactive Web Interface**: Browse flights with filtering, search, and detailed views
- **⚡ Optimized KML Processing**: Rename improperly formatted files and extract metadata
- **🎯 Airspace Violation Detection**: Identify flights that enter TMNP restricted zones
- **🗺️ Flight Map Generation**: Create detailed PNG maps with OSM backgrounds, flight paths, and violation markers
- **📊 Data Analytics**: Comprehensive flight statistics and violation patterns
- **✅ Data Validation**: Ensure data quality by removing false positives

## 🏢 Architecture Overview

This project is split into two main components designed for different purposes:

### 🌐 **Static Site** (`/static-site/`)
- **Purpose**: Public-facing website hosted on cheap cloud platforms
- **Audience**: End users, researchers, aviation authorities
- **Content**: 
  - Interactive map with all violation flights
  - Optimized KML files (smaller, processed versions)
  - Flight statistics and analytics
  - Search and filtering capabilities
- **Does NOT contain**: Original full-sized KML files or PNG violation screenshots
- **Hosting**: Designed for static hosting (GitHub Pages, Netlify, Vercel, etc.)

### 🔧 **Backend System** (`/backend/`)
- **Purpose**: Local data processing and analysis environment
- **Audience**: Data administrators and analysts
- **Content**:
  - Original full-sized KML files
  - Generated PNG flight violation screenshots
  - Processing scripts and tools
  - Backend web interface (`backend.html`)
- **Key Functions**:
  - Upload and validate new flight data
  - Generate PNG violation screenshots
  - Process and optimize KML files
  - Prepare data for static site deployment

## 🌍 Why This Project Exists

Table Mountain National Park has restricted airspace to protect wildlife and ensure visitor safety. However, helicopter operators sometimes violate these restrictions, either accidentally or intentionally. This system:

1. **Monitors Compliance**: Provides objective evidence of airspace violations
2. **Supports Enforcement**: Generates reports for regulatory bodies like SACAA
3. **Improves Safety**: Helps identify problematic flight patterns
4. **Protects Wildlife**: Reduces helicopter noise pollution in sensitive areas
5. **Provides Transparency**: Offers public visibility into airspace violations

The data helps aviation authorities, park management, and concerned citizens understand the scope of violations and take appropriate action.

## 🌐 Static Site

The static site is the **public face** of the project, designed to be hosted on affordable cloud platforms and accessible to end users worldwide.

### 🏠 Hosting Strategy
- **Platform**: GitHub Pages, Netlify, Vercel, or similar static hosting
- **Cost**: Free or very low cost (typically under $10/month)
- **Performance**: Fast global CDN delivery
- **Scalability**: Handles unlimited concurrent users

### 📁 What's Included
- **Interactive Flight Map**: Browse all violation flights with filtering
- **Optimized KML Files**: Smaller, processed versions for fast loading
- **Flight Statistics**: Analytics dashboard with violation patterns
- **Search & Filter**: Find specific flights by date, aircraft, or operator
- **Responsive Design**: Works on desktop, tablet, and mobile devices

### 🚫 What's NOT Included
- **Original Full KML Files**: Too large for static hosting
- **PNG Violation Screenshots**: Detailed violation imagery stays in backend
- **Processing Tools**: Data manipulation happens in backend only

### 🚀 Deployment Process
1. Backend processes and optimizes data
2. Optimized files are copied to `static-site/`
3. Static site is pushed to GitHub
4. Hosting platform automatically deploys updated site

## 🔧 Backend System

The backend system is where the **data processing magic happens**, designed to run locally for data administrators and analysts.

### 💻 Backend Web Interface
- **Access**: Start the server with `./launch.sh` and open `http://localhost:4000`
- **Purpose**: Manage and analyze flight data through a web interface
- **Features**:
  - Upload new KML files (drag & drop or file picker)
  - Smart KML Manager for automatic file organization
  - Real-time PNG violation screenshot generation
  - Metadata refresh and validation
  - File processing statistics and logs
  - Copy-to-clipboard admin commands for easy server management

### 📂 What's Stored Here
- **Original KML Files**: Full-resolution flight tracking data
- **PNG Screenshots**: Detailed violation maps with markers
- **Processing Scripts**: Tools for data validation and optimization
- **Metadata Cache**: Flight information and statistics
- **Legacy Data**: Historical processing files and backups

### 🔄 Data Processing Workflow
1. **Upload**: Add new KML files via web interface (drag & drop supported)
2. **Smart Processing**: Automatic file organization and duplicate detection
3. **Validate**: Check flights for TMNP airspace violations with real-time feedback
4. **Generate**: Create PNG screenshots showing violation points with OSM tiles
5. **Refresh**: Update metadata to include new flights in the system
6. **Build**: Generate optimized static site with new flight data
7. **Deploy**: Push optimized data to static site repository

## 🚀 Quick Start

**🏃 Want to start immediately?** Just run:
```bash
cd /Users/werner/Dev/heli/heli-map
./launch.sh
```
This starts both servers and opens both interfaces automatically!

---

The project is split into two parts: a static site and a backend. You can work with either component independently.

### Static Site (Public)
- Lives in: `static-site/`
- What it serves: Optimized KML files only (no large KMLs or PNGs)
- How it's updated: Pushing changes to GitHub triggers deployment

### Backend (Local Processing)
- Lives in: `backend/`
- Open `backend/backend.html` to:
  - Validate and process flights
  - Generate PNG violation screenshots
  - Optimize KML files
- When done, push updates so the static site reflects the new flights

### Development Setup

1. **Install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Start both servers (Unified Launcher - Recommended):**
   ```bash
   ./launch.sh
   ```
   This starts both the backend admin server (port 4000) AND the static site server (port 8080), then opens both interfaces in your browser automatically.

3. **OR start servers individually (Advanced):**
   ```bash
   # Backend only
   cd backend
   node scripts/index-no-auth.cjs
   
   # Static site only (in a separate terminal)
   cd backend/scripts
   node serve-static-site.cjs
   ```
   
   **Important**: The static site server MUST be running on port 8080 for local testing. This server serves the optimized KML files and other static assets locally before the site is deployed to the internet. Without this server, the "View Flight" functionality will fail because it cannot access the local optimized KML files.

4. **Access the interfaces:**
   - **Backend Admin**: `http://localhost:4000` (opens automatically)
   - **Static Site**: `http://localhost:8080` (opens automatically)
   - Both interfaces open in your browser when using the unified launcher

5. **Process flow:**
   - Upload KMLs via web interface → Smart KML Manager organizes files → PNG generation → Refresh Metadata → Build static site

6. **Deploy updates:**
   ```bash
   git add .
   git commit -m "Process new flights"
   git push
   ```
   Your static site host will deploy the updated `static-site/` automatically (if configured).

### 🌐 Local Testing

**Easy Way - Use the Unified Launcher:**

```bash
# From project root
./launch.sh
```

This automatically:
- ✅ Starts backend server (port 4000)
- ✅ Starts static site server (port 8080)
- ✅ Opens both interfaces in your browser
- ✅ Press Ctrl+C to stop both servers

**Access Points:**
- **Backend Admin**: http://localhost:4000
- **Static Site**: http://localhost:8080

**Why port 8080?** The static site must run on port 8080 (hardcoded) to serve optimized KML files locally before deployment.

**Troubleshooting:**
- If port 8080 is in use: `lsof -ti:8080 | xargs kill -9`
- Server logs show: "🌐 Static site server running at http://localhost:8080"
- Verify files are served from: `/Users/werner/Dev/heli/heli-map/static-site`


## 📂 Project Structure

```
heli-map/
├── launch.sh                        # 🚀 Unified launcher (starts both servers)
├── README.md                         # This documentation
├── WARP.md                          # Terminal/Warp guidelines
├── DEPLOYMENT.md                    # Deployment system documentation
├── .gitignore                       # Git ignore rules
├── .ai/                            # AI agent guidelines
│   └── guidelines                   # File organization rules for AI
│
├── static-site/                     # 🌐 PUBLIC WEBSITE (hosted)
│   ├── index.html                   # Main website interface
│   ├── icon.svg                     # Website favicon
│   ├── tmnp.kml                     # TMNP boundary definition
│   ├── kml-optimised/              # Optimized KML files (public)
│   ├── README.md                   # Static site documentation
│   └── images/                     # Website assets
│       ├── helicopters/            # Helicopter photos
│       ├── marker-icon.png         # Map marker icons
│       ├── marker-icon-2x.png      # High-DPI markers
│       └── marker-shadow.png       # Marker shadows
│
└── backend/                        # 🔧 DATA PROCESSING (local)
    ├── backend.html                # Admin web interface
    ├── launch-backend-only.sh      # Backend-only launcher (advanced)
    ├── package.json                # Node.js dependencies
    │
    ├── config/                     # ⚙️ Configuration files
    │   ├── deployment-config.json  # GitHub deployment settings
    │   └── deployment-status.json  # Current deployment state
    │
    ├── logs/                       # 📋 Log files (auto-generated, gitignored)
    │   ├── server.log              # Main backend server logs
    │   ├── static-site-server.log  # Static site server logs
    │   ├── deployment.log          # Deployment system logs
    │   └── optimize-kml.log        # KML optimization logs
    │
    ├── scripts/                    # 🚀 Production scripts
    │   ├── index-no-auth.cjs       # Main backend server
    │   ├── smart-kml-manager.cjs   # File organization & duplicates
    │   ├── generate-flight-image.cjs # PNG generation script
    │   ├── generate-master-metadata-main.cjs # Metadata generator
    │   ├── build-static-site.cjs   # Static site builder
    │   ├── serve-static-site.cjs   # Static site local testing server
    │   ├── deploy-to-github.cjs    # Git deployment automation
    │   └── optimise_kml.py         # KML optimization script
    │
    ├── tests/                      # 🧪 Test & debug scripts
    │   └── debug/                  # Debug scripts
    │       ├── test-*.cjs          # Test scripts
    │       └── debug-*.cjs         # Debug scripts
    │
    ├── server/                     # 📊 Metadata and runtime data
    │   ├── duplicates/             # Duplicate flight files
    │   ├── master-metadata.json    # Flight metadata cache
    │   ├── helicopters.json        # Aircraft information
    │   └── images/                 # Helicopter photos
    │
    ├── uploads/                    # ✈️ Original KML files (FULL SIZE)
    │   ├── ZS-HBO/                 # Organized by aircraft registration
    │   ├── ZS-HIE/                 # Each folder contains aircraft's KML files
    │   └── [other-aircraft]/       # Automatic organization by Smart KML Manager
    │
    ├── flight-maps/                # 🗺️ PNG violation screenshots
    │   ├── ZS-HBO/                 # Screenshots organized by aircraft
    │   ├── ZS-HIE/                 # Detailed violation imagery (private)
    │   └── [other-aircraft]/       # Not served on public site
    │
    ├── images/                     # Backend assets
    │   └── warning.png             # Violation marker icon
    │
    └── node_modules/               # Backend dependencies
```

## 🔄 Admin Workflow - Step-by-Step KML Processing

This is the **complete admin workflow** for processing new helicopter flight data from upload to deployment:

### ⚠️ Recent Changes & Fixes (October 2025)

**File Path Restructuring:**
- All server files moved from `/backend/server/` to `/backend/` root directory
- PNG flight maps now in `/backend/flight-maps/` (was `/backend/server/flight-maps/`)
- Original KML files now in `/backend/uploads/` (was `/backend/server/uploads/`)
- Metadata files now in `/backend/server/` (consolidated location)

**URL System Fixes:**
- **KML Downloads**: Fixed to use `raw.githubusercontent.com` for text files
- **PNG Images**: Use `media.githubusercontent.com` for Git LFS binary files
- **Static Site**: All file references updated to new backend paths
- **Build Scripts**: Updated to generate correct GitHub URLs

**Key URLs:**
- KML files: `https://raw.githubusercontent.com/werneravr/heli-map/main/backend/uploads/[filename]`
- PNG images: `https://media.githubusercontent.com/media/werneravr/heli-map/main/backend/flight-maps/[filename]`

### Initial Setup
**Admin starts the server:**
```bash
cd backend
./launch.sh
```
Open `http://localhost:4000` for the admin interface.

### Step 1: Upload KML Files
**Admin uploads KML file(s):**
- Use drag-and-drop interface or file picker in admin web interface
- Can upload single or multiple KML files simultaneously  
- Files typically come from FlightRadar24, ADS-B Exchange, or manual flight tracking exports

### Step 2: Automatic Duplicate Detection
**System automatically checks for duplicates:**
- Compares uploaded files against existing flights in the database
- Uses flight path analysis, not just filename comparison
- Prevents re-processing identical flights even if they have different filenames
- Duplicate files are moved to `/backend/server/duplicates/` folder
- Admin gets notification if duplicates are detected

### Step 3: TMNP Violation Detection
**System automatically validates if flight violates TMNP boundaries:**
- Analyzes flight path coordinates against Table Mountain National Park restricted airspace
- Uses geometric intersection analysis to detect boundary violations
- Only flights that actually entered restricted airspace proceed to next steps
- Non-violating flights are rejected with explanation to admin

### Step 4: File Renaming and Organization
**If flight is a valid violation, system automatically:**
- Renames KML file to standardized format: `[AIRCRAFT-REG]_[DATE]_violation.kml`
- Places renamed file in appropriate subfolder: `/backend/uploads/[AIRCRAFT-REGISTRATION]/`
- Organizes files by aircraft registration (e.g., `ZS-HBO`, `ZT-REG`, etc.)
- Updates file metadata and tracking information

### Step 5: Optimized KML Generation
**System automatically creates web-optimized version:**
- Generates compressed/optimized KML for better web performance
- Removes unnecessary data points while preserving violation evidence
- Saves optimized file to `/static-site/kml-optimised/` folder
- These optimized files are used by the public website for fast loading

### Step 6: PNG Violation Map Generation
**System automatically generates violation screenshot:**
- Creates detailed PNG image showing:
  - Flight path overlaid on OpenStreetMap background
  - TMNP boundary lines clearly marked
  - Specific violation points highlighted with markers
  - Aircraft registration and violation timestamp
- Saves PNG to `/backend/flight-maps/[AIRCRAFT-REGISTRATION]/` folder
- These detailed images remain private (backend only, not served on public site)

### Step 7: Git Deployment
**Admin manually commits and pushes to GitHub:**
```bash
# Add new KML files and PNG images to Git
git add backend/uploads/ backend/flight-maps/ static-site/kml-optimised/
git commit -m "Add new helicopter violations: [aircraft-registrations]"
git push origin main
```

### Step 8: Static Site Deployment
**Upload new static-site files to internet:**
- If using GitHub Pages/Netlify/Vercel: deployment happens automatically after Git push
- If using manual hosting: upload `/static-site/` folder contents to web server
- Public website will now display new violations with optimized KML files

## ⚠️ Critical Architecture Principle

### File Separation Rule
**The `/static-site/` NEVER references anything in `/backend/`:**

✅ **Static Site CAN Reference:**
- Files within `/static-site/` directory (like optimized KMLs)
- Images and KMLs served from GitHub raw URLs
- External CDN resources

❌ **Static Site CANNOT Reference:**
- Any files in `/backend/uploads/`
- Any files in `/backend/flight-maps/`
- Local backend server endpoints
- Relative paths pointing to backend folders

### Serving Strategy
- **Optimized KMLs**: Served from `/static-site/kml-optimised/` folder
- **Large Original KMLs**: Remain in backend, served from GitHub raw URLs when needed
- **PNG Screenshots**: Remain private in backend, NOT served on public site
- **Public Images**: Only helicopter photos and icons in `/static-site/images/`

### Step 3: File Organization

After processing, files are organized as:
```
backend/
├── config/            # Configuration files
│   ├── deployment-config.json
│   └── deployment-status.json
├── tests/            # Test and debug scripts
│   └── debug/        # Debug scripts
├── scripts/          # Production processing scripts
├── uploads/          # ✅ Original KML files (FULL SIZE)
│   ├── ZS-HBO/       # Organized by aircraft registration  
│   └── [aircraft]/   # Each aircraft gets its own folder
├── flight-maps/     # ✅ PNG violation screenshots
│   ├── ZS-HBO/       # Screenshots organized by aircraft
│   └── [aircraft]/   # Private detailed imagery
└── server/          # Metadata and runtime data
    ├── duplicates/  # Duplicate flight files
    ├── master-metadata.json
    └── helicopters.json

static-site/
└── kml-optimised/   # Public KML files (optimized only)
```

### Step 4: Static Site Update
- Optimized KMLs are copied to `static-site/kml-optimised/`
- Flight metadata is updated in static site
- Large PNG screenshots remain in backend only
- Static site gets new flights without bloat

### Step 5: Deployment
1. **Commit Changes**:
   ```bash
   git add .
   git commit -m "Add new helicopter flights"
   git push
   ```
2. **Automatic Deployment**: Hosting platform detects changes and deploys
3. **Public Access**: New flights appear on public website

## 🚀 Deployment

### Static Site Deployment
The `static-site/` folder is designed for deployment to:
- **GitHub Pages**: Free, automatic deployment from repository
- **Netlify**: Free tier with custom domains
- **Vercel**: Free tier with excellent performance
- **Any Static Host**: Basic web hosting

### Deployment Process
1. **Process Data**: Use backend to validate and optimize flights
2. **Commit to Git**: Push optimized data to repository
3. **Automatic Deploy**: Hosting platform builds and deploys
4. **Live Updates**: Public site reflects new flights

### What Gets Deployed
✅ **Included in Static Site:**
- Interactive flight map interface
- Optimized KML files (small, fast loading)
- Flight statistics and metadata
- Helicopter photos and basic assets

🚫 **NOT Included in Static Site:**
- Original large KML files (stay in `/backend/uploads/`)
- PNG violation screenshots (stay in `/backend/flight-maps/`, referenced via GitHub URLs)
- Processing scripts and tools
- Backend administration interface

### Backend Hosting
The backend remains local and is not deployed:
- **Purpose**: Data processing only
- **Access**: Local development environment
- **Security**: Sensitive processing tools stay private
- **Performance**: No hosting costs for large files

## 📈 System Summary

This helicopter tracking system successfully separates **public access** from **data processing**:

- **🌐 Static Site**: Lightweight, fast, affordable public interface
- **🔧 Backend**: Powerful local processing environment
- **🔄 Workflow**: Backend processes data → Static site displays results
- **🚀 Deployment**: Automated updates via Git push

The result is a cost-effective solution that can handle large datasets while providing fast public access to violation data.

## 🔧 Server Management & Troubleshooting

### ⚠️ Post-Migration Troubleshooting

After the recent file restructuring (October 2025), you may encounter these issues:

**Missing Files After Git Pull:**
```bash
# If files seem missing after pulling recent changes:
# Check that files moved to new locations:
ls -la backend/uploads/     # Should contain aircraft folders (ZS-HBO/, ZS-HIE/, etc.)
ls -la backend/flight-maps/ # Should contain PNG screenshots by aircraft
ls -la backend/server/      # Should contain metadata files
```

**KML Download Links Not Working:**
- **Symptom**: Clicking download buttons does nothing or shows 404 errors
- **Cause**: Static site may have old URLs pointing to `media.githubusercontent.com` instead of `raw.githubusercontent.com`
- **Solution**: Rebuild static site to generate updated URLs:
```bash
cd backend
node scripts/build-static-site.cjs
git add static-site/
git commit -m "Update static site with fixed KML URLs"
git push
```

**PNG Images Not Loading:**
- **Symptom**: "Take Action" button doesn't show flight images
- **Cause**: Static site references old `/server/flight-maps/` paths
- **Solution**: Already fixed in build scripts, rebuild if needed

**Build Script Errors:**
```bash
# If build script fails with path errors:
# Verify the new file structure exists:
find backend -name "*.kml" -type f | head -5  # Should show files in uploads/ subfolders
find backend -name "*.png" -type f | head -5  # Should show files in flight-maps/ subfolders
```

### Starting the Backend Server

**Recommended method:**
```bash
cd backend
./launch.sh
```

**Manual method:**
```bash
cd backend  
node scripts/index-no-auth.cjs
```

**Background mode (server keeps running after closing terminal):**
```bash
cd backend
nohup node scripts/index-no-auth.cjs > logs/server.log 2>&1 &
```

### Server Status & Monitoring

- **Admin Interface**: `http://localhost:4000`
- **Server Logs**: Check `backend/logs/server.log` for processing details
- **Status**: Admin interface shows current flights loaded and helicopter count

### Common Issues & Solutions

**Server won't start:**
```bash
# Check if port 4000 is in use
lsof -i :4000
# Kill any existing server
pkill -f "node.*index-no-auth.cjs"
```

**Missing dependencies:**
```bash
cd backend
npm install
```

**Metadata not updating:**
1. Use "Refresh Metadata" button in admin interface
2. Or manually regenerate: `node scripts/generate-master-metadata-main.cjs`

**Stop all servers:**
```bash
# Stop both backend and static site servers
lsof -ti:4000 -ti:8080 | xargs kill -9

# Verify they're stopped
lsof -i :4000 -i :8080

# Then visit:
# http://localhost:8080
```

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

## 📝 Development Notes

### ✅ Recent Major Changes (October 2025)

**Unified Launcher Created (October 9, 2025):**
- Created `/launch.sh` in project root - **ONE command to start everything**
- Starts both backend (port 4000) and static site (port 8080) servers
- Automatically opens both interfaces in browser
- Graceful shutdown with Ctrl+C (stops both servers cleanly)
- Logs written to `/backend/logs/` for troubleshooting
- Moved old `/backend/launch.sh` to `/backend/launch-backend-only.sh` (advanced use)

**File Organization Restructuring (October 9, 2025):**
- Created `/backend/tests/debug/` directory for all test and debug scripts
- Created `/backend/config/` directory for configuration files
- Created `/backend/logs/` directory for all log files
- Moved 16 test/debug scripts from `/backend/` root to `/backend/tests/debug/`
- Moved configuration files to `/backend/config/`
- Moved all log files to `/backend/logs/` (centralized logging)
- Moved `DEPLOYMENT-README.md` from `/backend/` to project root as `DEPLOYMENT.md`
- Removed `/static-site/flight-maps/` directory (empty, violated architecture principle)
- Established principles:
  - **All `.md` documentation files belong in project root**
  - **All `.log` files go in `/backend/logs/`** (never in backend root or project root)
  - **PNG flight maps NEVER go in static site** (backend only, referenced via GitHub URLs)
- Created `.ai/guidelines` file with comprehensive file organization rules for AI agents
- Updated all documentation (README.md, WARP.md, DEPLOYMENT.md) with new structure
- All relative paths in moved scripts updated to work from new locations

**File System Restructuring (October 2025):**
- Moved all core data files from nested `/backend/server/` to `/backend/` root level
- This simplifies the architecture and makes file locations more intuitive
- Updated all scripts and build processes to use new paths

**URL System Overhaul:**
- **KML Files**: Now correctly use `raw.githubusercontent.com` (for text files)
- **PNG Files**: Use `media.githubusercontent.com` (for Git LFS binary files)
- **Static Site**: All references updated to point to correct GitHub URLs
- **Build Scripts**: Generate proper URLs automatically

**Why This Matters for AI Agents:**
- File paths are now consistent and predictable
- GitHub URLs work correctly for both KML downloads and PNG previews
- Build system automatically generates correct URLs
- No more manual URL fixes needed after deployment

**Key Architecture Points:**
1. **Backend Processing**: Files stay in `/backend/uploads/` and `/backend/flight-maps/`
2. **Static Site Serving**: References files via GitHub raw/media URLs
3. **URL Domain Logic**: 
   - Text files (KML) → `raw.githubusercontent.com`
   - Binary files (PNG) → `media.githubusercontent.com`
4. **Build Process**: Automatically generates correct URLs based on file type

### 🚀 For Future Development

When working on this project, remember:

**File Locations (Post-October 9, 2025):**
- Production Scripts: `/backend/scripts/[script-name].cjs`
- Test/Debug Scripts: `/backend/scripts/tests/[test-name].cjs`
- Configuration Files: `/backend/config/[config-name].json`
- Original KMLs: `/backend/uploads/[aircraft]/[filename].kml`
- PNG Screenshots: `/backend/flight-maps/[aircraft]/[filename].png`
- Metadata: `/backend/server/master-metadata.json`
- Optimized KMLs: `/static-site/kml-optimised/[filename].kml`

**File Organization Guidelines:**
- **See `.ai/guidelines`** for comprehensive file organization rules
- Never create test/debug scripts in `/backend/` root
- Never create config files in `/backend/` root
- Use proper naming: `test-*.cjs`, `debug-*.cjs`, or `[action]-[noun].cjs`
- Keep production and debug code separate

**URL Generation:**
- Use `build-static-site.cjs` to generate URLs automatically
- Don't hardcode GitHub URLs in templates
- Test both KML downloads and PNG previews after changes

**Testing:**
- Always test with the static site server on port 8080
- Verify KML downloads work from GitHub URLs
- Check PNG previews load correctly in "Take Action" modals
- Debug scripts are available in `/backend/scripts/tests/`

## 🤝 Contributing

Contributions are welcome! This project can be improved in many areas:

### Development Areas
- **🌐 Static Site**: Enhance the public interface and user experience
- **🔧 Backend Processing**: Improve data validation and optimization scripts
- **🗺️ Visualizations**: Better maps and violation detection displays
- **📱 Mobile Experience**: Optimize for mobile devices
- **📊 Analytics**: Advanced violation pattern analysis
- **📋 Documentation**: Expand guides and tutorials

### Development Workflow
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes to either `static-site/` or `backend/`
4. Test thoroughly with real data
5. Commit with descriptive messages
6. Push to your fork and create a Pull Request

### Code Guidelines
- Follow existing file organization patterns
- Comment complex geospatial calculations
- Test with real KML data before submitting
- Keep static site lightweight for fast hosting

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
