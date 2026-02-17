# TMNP Helicopter Tracking - Static Site

This is a static website generated from the TMNP Helicopter Tracking System.

## 🚀 Features

- **Interactive Map**: View flight paths and TMNP boundary
- **Flight Database**: Browse all 1651 detected flights
- **Search & Filter**: Find flights by registration, date range
- **Download KML**: Get original flight data files
- **Export CSV**: Export filtered data for analysis
- **Flight Maps**: View generated PNG flight path images

## 📁 Contents

- `index.html` - Main website
- `kml-optimised/` - Optimized KML flight files (for map display)
- `aircraft-images/` - Aircraft registration photos
- `tmnp.kml` - Table Mountain National Park boundary
- `master-metadata.json` - Flight metadata

Original KML files and PNG flight maps are served from `backend/uploads/` and `backend/flight-maps/` via GitHub raw/media URLs.

## 🌐 Deployment

This static site is deployed to **GitHub Pages**.

To deploy updates, use the backend admin interface at http://localhost:4000

## 🔧 Local Development

To regenerate this site with updated data:

```bash
node build-static-site.cjs
```

## 📊 Data Source

Generated from 1651 flights detected with NP17 airspace violations over Table Mountain National Park.

Last updated: 2026-02-17T07:44:53.905Z
