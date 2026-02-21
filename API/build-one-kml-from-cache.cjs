#!/usr/bin/env node
/**
 * Build a single KML file from cached FR24 track (no API call).
 * Usage: node API/build-one-kml-from-cache.cjs <flight_id>
 * Example: node API/build-one-kml-from-cache.cjs 3dbd63f4
 * Writes: API/<flight_id>.kml
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const CACHE_DIR = path.join(ROOT, 'cache', 'fr24-tracks');

function ftToM(ft) {
  const x = Number(ft);
  return Number.isFinite(x) ? x * 0.3048 : NaN;
}

function getTracks(trackResponse) {
  return (
    trackResponse?.tracks ||
    trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null)
  );
}

function extractLonLatAlt(trackResponse) {
  const maybeTracks = getTracks(trackResponse);
  if (!Array.isArray(maybeTracks)) return [];
  return maybeTracks
    .map((p) => {
      const lon = Number(p?.lon);
      const lat = Number(p?.lat);
      const altFt = Number(p?.alt);
      const altM = Number.isFinite(altFt) ? ftToM(altFt) : 0;
      return [lon, lat, altM];
    })
    .filter(([lon, lat]) => Number.isFinite(lat) && Number.isFinite(lon));
}

function extractMeta(trackResponse) {
  const tracks = getTracks(trackResponse);
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const first = tracks[0] || {};
  const last = tracks[tracks.length - 1] || {};
  return {
    first_seen: typeof first.timestamp === 'string' ? first.timestamp : null,
    last_seen: typeof last.timestamp === 'string' ? last.timestamp : null,
    callsign: typeof first.callsign === 'string' ? first.callsign : (typeof last.callsign === 'string' ? last.callsign : null),
    points: tracks.length
  };
}

function buildKmlLineString({ name, coordinatesLonLatAlt, description }) {
  const coordsText = (coordinatesLonLatAlt || [])
    .map(([lon, lat, altM]) => `${lon},${lat},${Number(altM) ?? 0}`)
    .join(' ');
  const safeName = (name || 'Flight track').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const descBlock =
    description != null && description !== ''
      ? `\n      <description><![CDATA[${String(description).replace(/]]>/g, ']]]]><![CDATA[>')}]]></description>\n`
      : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `  <Document>\n` +
    `    <name>${safeName}</name>\n` +
    `    <Placemark>\n` +
    `      <name>${safeName}</name>${descBlock}` +
    `      <Style><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>\n` +
    `      <LineString>\n` +
    `        <tessellate>1</tessellate>\n` +
    `        <altitudeMode>absolute</altitudeMode>\n` +
    `        <coordinates>${coordsText}</coordinates>\n` +
    `      </LineString>\n` +
    `    </Placemark>\n` +
    `  </Document>\n` +
    `</kml>\n`
  );
}

function main() {
  const flightId = process.argv[2] || '3dbd63f4';
  const safeKey = flightId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cachePath = path.join(CACHE_DIR, `${safeKey}.json`);
  if (!fs.existsSync(cachePath)) {
    console.error('Cache file not found:', cachePath);
    process.exit(1);
  }
  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const result = cached?.result ?? cached;
  const response = result?.response;
  if (!response) {
    console.error('No response in cache:', cachePath);
    process.exit(1);
  }
  const coordsAlt = extractLonLatAlt(response);
  const meta = extractMeta(response);
  const name = meta?.callsign ? `FR24 ${meta.callsign} ${flightId}` : `FR24 ${flightId}`;
  // User-facing times: SAST (UTC+2), not UTC
  const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
  function parseUtcIsoToMs(iso) {
    const s = String(iso || '').trim();
    const withZ = /Z$/i.test(s) ? s : `${s}Z`;
    const ms = Date.parse(withZ);
    return Number.isFinite(ms) ? ms : NaN;
  }
  function msToSastDateTime(ms) {
    if (!Number.isFinite(Number(ms))) return '';
    const d = new Date(Number(ms) + SAST_OFFSET_MS);
    const pad2 = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  }
  const startSast = meta?.first_seen ? msToSastDateTime(parseUtcIsoToMs(meta.first_seen)) : null;
  const endSast = meta?.last_seen ? msToSastDateTime(parseUtcIsoToMs(meta.last_seen)) : null;
  const descriptionParts = [
    'Source: ADS-B',
    startSast ? `Start (SAST): ${startSast}` : null,
    endSast ? `End (SAST): ${endSast}` : null,
    meta?.points ? `Points: ${meta.points}` : null
  ].filter(Boolean);
  const kml = buildKmlLineString({
    name,
    coordinatesLonLatAlt: coordsAlt,
    description: descriptionParts.join('\n')
  });
  const outPath = path.join(ROOT, `${flightId}.kml`);
  fs.writeFileSync(outPath, kml, 'utf8');
  console.log('Wrote', outPath, '(' + coordsAlt.length, 'points, 3D with altitude)');
}

main();
