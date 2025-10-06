#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8080;
const STATIC_DIR = path.join(__dirname, '../../static-site');

// MIME types for different file extensions
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.kml': 'application/vnd.google-earth.kml+xml',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon'
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return mimeTypes[ext] || 'application/octet-stream';
}

function serveFile(filePath, res) {
    const mimeType = getMimeType(filePath);
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }
        
        res.writeHead(200, { 
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*', // Allow CORS for local development
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end(data);
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = path.join(STATIC_DIR, url.pathname);
    
    // Default to index.html for root path
    if (url.pathname === '/') {
        filePath = path.join(STATIC_DIR, 'index.html');
    }
    
    // Security: prevent directory traversal
    if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }
    
    // Check if file exists
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }
        
        serveFile(filePath, res);
    });
});

server.listen(PORT, () => {
    console.log(`🌐 Static site server running at http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${STATIC_DIR}`);
    console.log(`\n🚀 Open your browser to: http://localhost:${PORT}`);
    console.log(`\n💡 This local server allows the static site to work without internet connection`);
    console.log(`   by serving all files locally, including the tmnp.kml boundary file.`);
    console.log(`\n🛑 Press Ctrl+C to stop the server`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});
