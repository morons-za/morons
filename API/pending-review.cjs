#!/usr/bin/env node
/**
 * Pending review queue for suspicious flights.
 *
 * Manages a JSON file that holds flights flagged for manual review
 * (e.g. transponder gap false positives) and records approve/reject decisions.
 *
 * File location: static-site/pending-review.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PENDING_PATH = path.join(__dirname, '..', 'static-site', 'pending-review.json');

function readPendingReview() {
  try {
    if (!fs.existsSync(PENDING_PATH)) return { pending: [], decisions: [] };
    return JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
  } catch {
    return { pending: [], decisions: [] };
  }
}

function writePendingReview(data) {
  fs.writeFileSync(PENDING_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Generate an HMAC-SHA256 token for a review action.
 * @param {string} flightId
 * @param {string} action - 'approve' or 'reject'
 * @param {string} secret - shared HMAC secret
 * @param {number} [expiryDays=7]
 * @returns {{ token: string, expires: string }}
 */
function generateReviewToken(flightId, action, secret, expiryDays = 7) {
  const expires = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const payload = `${flightId}:${action}:${expires}`;
  const token = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { token, expires };
}

/**
 * Validate an HMAC-SHA256 review token.
 * @param {string} flightId
 * @param {string} action
 * @param {string} token
 * @param {string} expires - ISO date string
 * @param {string} secret
 * @returns {boolean}
 */
function validateReviewToken(flightId, action, token, expires, secret) {
  if (new Date(expires) < new Date()) return false;
  const payload = `${flightId}:${action}:${expires}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Add a flight to the pending review queue.
 * @param {object} flight - { flight_id, filename, registration, date, reason, maxGapKm, ... }
 * @param {string} secret - HMAC secret for token generation
 * @param {number} [expiryDays=7]
 */
function addPendingFlight(flight, secret, expiryDays = 7) {
  const data = readPendingReview();

  if (data.pending.some((f) => f.flight_id === flight.flight_id)) return;
  if (data.decisions.some((d) => d.flight_id === flight.flight_id)) return;

  const approve = generateReviewToken(flight.flight_id, 'approve', secret, expiryDays);
  const reject = generateReviewToken(flight.flight_id, 'reject', secret, expiryDays);

  data.pending.push({
    ...flight,
    detected_at: new Date().toISOString(),
    approve_token: approve.token,
    approve_expires: approve.expires,
    reject_token: reject.token,
    reject_expires: reject.expires
  });

  writePendingReview(data);
}

/**
 * Record a review decision (called by the Cloudflare Worker via GitHub API).
 * @param {string} flightId
 * @param {'approve'|'reject'} action
 * @returns {object|null} The decided flight entry, or null if not found
 */
function recordDecision(flightId, action) {
  const data = readPendingReview();
  const idx = data.pending.findIndex((f) => f.flight_id === flightId);
  if (idx === -1) return null;

  const [flight] = data.pending.splice(idx, 1);
  data.decisions.push({
    ...flight,
    action,
    decided_at: new Date().toISOString()
  });

  writePendingReview(data);
  return flight;
}

/**
 * Get all pending flights that have been approved (for processing into the static site).
 * @returns {object[]}
 */
function getApprovedFlights() {
  const data = readPendingReview();
  return data.decisions.filter((d) => d.action === 'approve');
}

/**
 * Get all pending flights that have been rejected (for cleanup).
 * @returns {object[]}
 */
function getRejectedFlights() {
  const data = readPendingReview();
  return data.decisions.filter((d) => d.action === 'reject');
}

/**
 * Remove processed decisions from the file (after publish or cleanup is done).
 * @param {string[]} flightIds - IDs to clear from decisions
 */
function clearProcessedDecisions(flightIds) {
  const data = readPendingReview();
  const idSet = new Set(flightIds);
  data.decisions = data.decisions.filter((d) => !idSet.has(d.flight_id));
  writePendingReview(data);
}

module.exports = {
  PENDING_PATH,
  readPendingReview,
  writePendingReview,
  generateReviewToken,
  validateReviewToken,
  addPendingFlight,
  recordDecision,
  getApprovedFlights,
  getRejectedFlights,
  clearProcessedDecisions
};
