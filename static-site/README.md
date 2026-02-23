# TMNP Helicopter Tracking - Static Site

This is a static website generated from the TMNP Helicopter Tracking System.

## 🚀 Features

- **Interactive Map**: View flight paths and TMNP boundary
- **Flight Database**: Browse all 1393 detected flights
- **Search & Filter**: Find flights by registration, date range
- **Download KML**: Get original flight data files
- **Export CSV**: Export filtered data for analysis
- **Flight Maps**: View generated PNG flight path images

## 📁 Contents

- `index.html` - Main website
- `kml/` - All KML flight files
- `flight-maps/` - Generated PNG flight path images
- `tmnp.kml` - Table Mountain National Park boundary

## 🌐 Deployment

This static site is deployed to **GitHub Pages**.

To deploy updates, use the backend admin interface at http://localhost:4000

## 🔧 Local Development

To regenerate this site with updated data:

```bash
node build-static-site.cjs
```

## 📊 Data Source

Generated from 1393 flights detected with NP17 airspace violations over Table Mountain National Park.

Last updated: 2026-02-23T21:40:59.218Z
