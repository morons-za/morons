#!/usr/bin/env node
/**
 * Transponder gap detection for FR24 flight tracks.
 *
 * Identifies flights with suspiciously long straight-line segments between
 * consecutive track points, which typically indicate the transponder was
 * turned off and on again. These create false violation positives when
 * the straight line crosses the TMNP boundary.
 *
 * Usage as module:
 *   const { analyseTrackForGaps } = require('./detect-transponder-gaps.cjs');
 *   const result = analyseTrackForGaps(trackResponse, { thresholdKm: 15, ratioThreshold: 5 });
 *   // result.suspicious  -- boolean
 *   // result.maxGapKm    -- largest gap in km
 *   // result.avgSegmentKm -- average segment length
 *   // result.gaps[]      -- array of { fromIdx, toIdx, distanceKm, from, to }
 *
 * Usage as CLI:
 *   node API/detect-transponder-gaps.cjs <flight_id>
 *   (reads from API/cache/fr24-tracks/<flight_id>.json)
 */

const fs = require('fs');
const path = require('path');

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractTracks(trackResponse) {
  return (
    trackResponse?.tracks ||
    trackResponse?.data?.tracks ||
    (Array.isArray(trackResponse) ? trackResponse?.[0]?.tracks : null) ||
    (Array.isArray(trackResponse?.data) ? trackResponse?.data?.[0]?.tracks : null) ||
    []
  );
}

/**
 * Analyse an FR24 track response for transponder gaps.
 *
 * @param {object} trackResponse - Raw FR24 track API response (or the cached .result.response)
 * @param {object} [opts]
 * @param {number} [opts.thresholdKm=15]   - Absolute distance threshold: any segment longer than this is a gap
 * @param {number} [opts.ratioThreshold=5] - Ratio threshold: segment > ratio * avgSegment is a gap
 * @returns {{ suspicious: boolean, maxGapKm: number, avgSegmentKm: number, totalSegments: number, gaps: object[] }}
 */
function analyseTrackForGaps(trackResponse, opts = {}) {
  const thresholdKm = opts.thresholdKm ?? 15;
  const ratioThreshold = opts.ratioThreshold ?? 5;

  const tracks = extractTracks(trackResponse);
  const pts = (Array.isArray(tracks) ? tracks : [])
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon), timestamp: p?.timestamp || null }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length < 2) {
    return { suspicious: false, maxGapKm: 0, avgSegmentKm: 0, totalSegments: 0, gaps: [] };
  }

  const segments = [];
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    segments.push({ fromIdx: i - 1, toIdx: i, distanceKm: d });
  }

  const totalDist = segments.reduce((s, seg) => s + seg.distanceKm, 0);
  const avgSegmentKm = totalDist / segments.length;
  const maxGapKm = Math.max(...segments.map((s) => s.distanceKm));

  const gaps = segments
    .filter((seg) => seg.distanceKm > thresholdKm || seg.distanceKm > avgSegmentKm * ratioThreshold)
    .map((seg) => ({
      fromIdx: seg.fromIdx,
      toIdx: seg.toIdx,
      distanceKm: Math.round(seg.distanceKm * 100) / 100,
      from: { lat: pts[seg.fromIdx].lat, lon: pts[seg.fromIdx].lon, timestamp: pts[seg.fromIdx].timestamp },
      to: { lat: pts[seg.toIdx].lat, lon: pts[seg.toIdx].lon, timestamp: pts[seg.toIdx].timestamp }
    }));

  return {
    suspicious: gaps.length > 0,
    maxGapKm: Math.round(maxGapKm * 100) / 100,
    avgSegmentKm: Math.round(avgSegmentKm * 100) / 100,
    totalSegments: segments.length,
    gaps
  };
}

/**
 * Classify a violating flight as 'gap_only', 'mixed', or 'clean'.
 *
 * - 'clean':    no transponder gaps detected
 * - 'mixed':    gaps exist, but real (non-gap) segments also violate TMNP
 * - 'gap_only': the ONLY segments that violate TMNP are gap segments
 *
 * @param {object} trackResponse - raw FR24 track API response
 * @param {object} [gapResult]   - output of analyseTrackForGaps (computed if omitted)
 * @param {object} [opts]        - options for analyseTrackForGaps
 * @returns {{ classification: 'clean'|'mixed'|'gap_only', realViolationCount: number, gapViolationCount: number }}
 */
function classifyViolation(trackResponse, gapResult, opts = {}) {
  const { segmentViolatesTMNP, loadTMNPPolygons } = require('./tmnp-geometry.cjs');
  const polys = loadTMNPPolygons();

  if (!gapResult) gapResult = analyseTrackForGaps(trackResponse, opts);
  if (!gapResult.suspicious) return { classification: 'clean', realViolationCount: 0, gapViolationCount: 0 };

  const tracks = extractTracks(trackResponse);
  const pts = (Array.isArray(tracks) ? tracks : [])
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length < 2) return { classification: 'clean', realViolationCount: 0, gapViolationCount: 0 };

  const gapSegments = new Set();
  for (const gap of gapResult.gaps) {
    gapSegments.add(gap.fromIdx);
  }

  let realViolationCount = 0;
  let gapViolationCount = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const violates = segmentViolatesTMNP(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon, polys);
    if (!violates) continue;
    if (gapSegments.has(i)) {
      gapViolationCount++;
    } else {
      realViolationCount++;
    }
  }

  const classification = realViolationCount > 0 ? 'mixed' : 'gap_only';
  return { classification, realViolationCount, gapViolationCount };
}

// CLI mode
if (require.main === module) {
  const flightId = process.argv[2];
  if (!flightId) {
    console.error('Usage: node API/detect-transponder-gaps.cjs <flight_id>');
    process.exit(1);
  }

  const cachePath = path.join(__dirname, 'cache', 'fr24-tracks', `${flightId}.json`);
  if (!fs.existsSync(cachePath)) {
    console.error(`No cached track data at ${cachePath}`);
    process.exit(1);
  }

  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const trackResponse = cached?.result?.response;
  if (!trackResponse) {
    console.error('No response in cached track data');
    process.exit(1);
  }

  const result = analyseTrackForGaps(trackResponse);
  console.log(JSON.stringify(result, null, 2));

  if (result.suspicious) {
    const cv = classifyViolation(trackResponse, result);
    console.log('Classification:', JSON.stringify(cv, null, 2));
  }
}

module.exports = { analyseTrackForGaps, classifyViolation, haversineKm, extractTracks };
