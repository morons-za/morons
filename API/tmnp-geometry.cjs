#!/usr/bin/env node
/**
 * Shared TMNP boundary geometry: polygon loading, point-in-polygon,
 * segment intersection, and track-level violation checking.
 *
 * Used by daily-sync, detect-transponder-gaps, sync-violations, etc.
 */

const fs = require('fs');
const path = require('path');

const TMNP_KML_PATH = path.join(__dirname, '..', 'static-site', 'tmnp.kml');

let _cachedPolygons = null;

function parseKmlCoordinatesText(coordsText) {
  const points = [];
  const cleaned = String(coordsText || '').trim();
  if (!cleaned) return points;
  for (const tok of cleaned.split(/\s+/)) {
    const parts = tok.split(',');
    if (parts.length < 2) continue;
    const lon = Number(parts[0]), lat = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lon, lat]);
  }
  if (points.length > 2) {
    const [lon0, lat0] = points[0], [lonn, latn] = points[points.length - 1];
    if (lon0 !== lonn || lat0 !== latn) points.push([lon0, lat0]);
  }
  return points;
}

function loadTMNPPolygons() {
  if (_cachedPolygons) return _cachedPolygons;
  if (!fs.existsSync(TMNP_KML_PATH)) return [];
  const xml = fs.readFileSync(TMNP_KML_PATH, 'utf8');
  const polygons = [];
  for (const m of xml.matchAll(/<Polygon[\s\S]*?<\/Polygon>/g)) {
    const polyText = m[0];
    const outerMatch = polyText.match(/<outerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
    if (!outerMatch) continue;
    const outer = parseKmlCoordinatesText(outerMatch[1]);
    if (outer.length < 4) continue;
    const inner = [];
    for (const im of polyText.matchAll(/<innerBoundaryIs[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi)) {
      const hole = parseKmlCoordinatesText(im[1]);
      if (hole.length >= 4) inner.push(hole);
    }
    polygons.push({ outer, inner });
  }
  _cachedPolygons = polygons;
  return polygons;
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInTMNP(lat, lon, polys) {
  if (!polys) polys = loadTMNPPolygons();
  for (const p of polys) {
    if (!pointInPolygon([lon, lat], p.outer)) continue;
    let inHole = false;
    for (const h of p.inner) { if (pointInPolygon([lon, lat], h)) { inHole = true; break; } }
    if (!inHole) return true;
  }
  return false;
}

function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSeg(a, b, c) {
  return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
         Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
}
function segIntersect(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 === 0 && onSeg(a, b, c)) return true;
  if (o2 === 0 && onSeg(a, b, d)) return true;
  if (o3 === 0 && onSeg(c, d, a)) return true;
  if (o4 === 0 && onSeg(c, d, b)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * Check if a single track segment (A→B) violates TMNP.
 * Returns true if either endpoint is inside TMNP, or the segment
 * crosses a TMNP boundary with the midpoint inside.
 */
function segmentViolatesTMNP(latA, lonA, latB, lonB, polys) {
  if (!polys) polys = loadTMNPPolygons();
  if (pointInTMNP(latA, lonA, polys)) return true;
  if (pointInTMNP(latB, lonB, polys)) return true;
  const a = [lonA, latA], b = [lonB, latB];
  for (const poly of polys) {
    let hit = false;
    for (let j = 0; j < poly.outer.length - 1; j++) {
      if (segIntersect(a, b, poly.outer[j], poly.outer[j + 1])) { hit = true; break; }
    }
    if (!hit) continue;
    const midLat = (latA + latB) / 2, midLon = (lonA + lonB) / 2;
    if (pointInTMNP(midLat, midLon, polys)) return true;
  }
  return false;
}

module.exports = {
  loadTMNPPolygons,
  pointInTMNP,
  segmentViolatesTMNP,
  pointInPolygon,
  segIntersect
};
