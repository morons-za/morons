const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

const server = http.createServer((req, res) => {
    // Serve the HTML file
    if (req.url === '/' || req.url === '/opensky-test.html') {
        const filePath = path.join(__dirname, 'opensky-test.html');
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading page');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`\n🚀 OpenSky Test Server running at http://localhost:${PORT}`);
    console.log(`\n📝 Instructions:`);
    console.log(`   1. Open http://localhost:${PORT} in your browser`);
    console.log(`   2. Upload your credentials.json file or paste credentials`);
    console.log(`   3. Click "Test Connection"`);
    console.log(`\n⏹️  Press Ctrl+C to stop the server\n`);
});
