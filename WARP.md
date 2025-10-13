# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is the **TMNP Helicopter Tracking System** - a Node.js web application that monitors helicopter flights violating Table Mountain National Park restricted airspace. The system processes KML flight data, detects airspace violations, and generates flight map visualizations.

## Common Development Commands

### Project Setup
```bash
# Install backend dependencies
cd backend
npm install

# Start BOTH servers (Recommended)
cd ..  # Back to project root
./launch.sh

# OR start servers individually (Advanced)
cd backend
node scripts/index-no-auth.cjs  # Backend only

# In another terminal:
cd backend/scripts
node serve-static-site.cjs  # Static site only
```

### Server Management
```bash
# Check backend server status (port 4000)
lsof -i :4000

# Check static site server status (port 8080) 
lsof -i :8080

# Kill existing servers if needed
pkill -f "node.*index-no-auth.cjs"
lsof -ti:8080 | xargs kill -9
```

## Admin Workflow - Step-by-Step KML Processing

This is the **core admin workflow** for processing new helicopter flight data:

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
- Duplicate files are rejected and deleted (not stored)
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

## Critical Architecture Principle

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

## Architecture Overview

### Backend System (`/backend/`)
**Purpose**: Local data processing and admin interface
- **Original KML Storage**: Full-resolution flight data in organized subfolders
- **PNG Screenshots**: Detailed violation maps (private, not served publicly)
- **Processing Scripts**: Duplicate detection, violation analysis, image generation
- **Admin Interface**: Web UI at `http://localhost:4000` for file management

### Static Site (`/static-site/`)
**Purpose**: Public-facing website (hosted on internet)
- **Optimized KMLs**: Compressed versions for fast web loading
- **Interactive Interface**: Flight map, filtering, search capabilities
- **NO Backend References**: Completely self-contained for static hosting

## Processing Scripts

### Key Backend Scripts
```bash
# Main admin server
backend/scripts/index-no-auth.cjs

# Smart KML processing and duplicate detection  
backend/scripts/smart-kml-manager.cjs

# PNG violation map generation
backend/scripts/generate-flight-image.cjs

# Metadata refresh and database updates
backend/scripts/generate-master-metadata-main.cjs

# Static site optimization and building
backend/scripts/build-static-site.cjs

# KML file optimization
backend/scripts/optimise_kml.py
```

## File Structure After Processing

```
backend/
├── config/                    # Configuration files
│   ├── deployment-config.json
│   └── deployment-status.json
├── scripts/                   # Production scripts
│   ├── index-no-auth.cjs     # Main server
│   ├── smart-kml-manager.cjs # KML processing
│   ├── generate-flight-image.cjs # PNG generation
│   ├── build-static-site.cjs # Site builder
│   └── tests/                # Test and debug scripts
│       ├── test-*.cjs        # Test scripts
│       └── debug-*.cjs       # Debug scripts
├── uploads/                   # Original KML files
│   ├── ZS-HBO/               # Organized by aircraft
│   │   ├── ZS-HBO_2024-03-15_violation.kml
│   │   └── ZS-HBO_2024-04-22_violation.kml
│   ├── ZT-REG/                
│   └── [other-aircraft]/
├── flight-maps/              # PNG violation screenshots  
│   ├── ZS-HBO/
│   │   ├── ZS-HBO_2024-03-15_violation.png
│   │   └── ZS-HBO_2024-04-22_violation.png
│   └── [other-aircraft]/
└── server/                   # Metadata and runtime data
    ├── master-metadata.json  # Flight database
    └── helicopters.json      # Aircraft info

static-site/
├── kml-optimised/            # Optimized KMLs for public web
│   ├── ZS-HBO_2024-03-15_optimised.kml
│   ├── ZS-HBO_2024-04-22_optimised.kml  
│   └── [other-flights]_optimised.kml
├── index.html                # Public website
└── [other-public-files]
```

## Development Notes

### System Requirements
- **Node.js**: Version 14+ for backend processing
- **Python 3**: For KML optimization scripts
- **Git**: For deployment workflow
- **Sharp**: For PNG image generation

### Port Configuration
- **Backend Admin**: `http://localhost:4000`
- **Static Site Testing**: `http://localhost:8080`

### Data Processing Flow
1. **Upload** → KML files via admin web interface
2. **Detect** → Automatic duplicate checking
3. **Validate** → TMNP violation boundary analysis  
4. **Process** → File renaming and organization
5. **Optimize** → Create web-friendly KML versions
6. **Generate** → PNG violation screenshots
7. **Deploy** → Git push + static site upload

### Troubleshooting
```bash
# Check server status
curl http://localhost:4000/api/status

# View processing logs
tail -f backend/logs/server.log

# Reset stuck uploads
rm -rf backend/uploads/temp/
```

## File Organization Rules for AI Agents

### Where to Create New Files

**Production Scripts**: `/backend/scripts/`
- Scripts that are part of the core workflow
- Examples: `generate-flight-image.cjs`, `smart-kml-manager.cjs`, `build-static-site.cjs`
- Naming: `[action]-[noun].cjs` (e.g., `generate-flight-image.cjs`)

**Test/Debug Scripts**: `/backend/scripts/tests/`
- Temporary debugging scripts
- Unit tests for features
- Examples: `test-violation.cjs`, `debug-coordinates.cjs`
- Naming: `test-[feature].cjs` or `debug-[feature].cjs`

**Configuration Files**: `/backend/config/`
- System configuration files
- State tracking files
- Examples: `deployment-config.json`, `deployment-status.json`

**Metadata/Runtime Data**: `/backend/server/`
- Flight metadata and aircraft information
- Cached data
- Examples: `master-metadata.json`, `helicopters.json`

### DO NOT CREATE FILES IN:
- ❌ `/backend/` root (reserved for `package.json`, `backend.html`, `launch.sh` only)
- ❌ Project root (reserved for `.md` documentation files and config files like `.gitignore` only)
- ❌ `/static-site/` (this is generated by build scripts, never edit manually)

### Documentation Files:
- ✅ All `.md` files belong in project root (`/`)
- Examples: `README.md`, `WARP.md`, `DEPLOYMENT.md`
- Exception: `/static-site/README.md` (part of deployed site)

### Before Creating a New File, Ask:
1. Is this production code? → `/backend/scripts/`
2. Is this a test/debug script? → `/backend/scripts/tests/`
3. Is this configuration? → `/backend/config/`
4. Is this metadata/runtime data? → `/backend/server/`

**For detailed guidelines, see `.ai/guidelines` file.**

## Important Notes for AI Agents

- **All heavy processing happens locally** on admin machine, not on hosted site
- **Public website only shows optimized files** - original KMLs and PNGs stay private
- **Deployment requires manual Git workflow** - no automatic deployment
- **Duplicate detection uses flight path analysis**, not filename matching
- **Only validated violating flights** proceed through the full processing pipeline
- **Follow file organization rules** - see File Organization section above and `.ai/guidelines`