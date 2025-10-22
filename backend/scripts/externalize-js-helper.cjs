// Helper script to externalize JavaScript from build-static-site.cjs
const fs = require('fs');
const path = require('path');

// Read the build script
const buildScriptPath = path.join(__dirname, 'build-static-site.cjs');
const content = fs.readFileSync(buildScriptPath, 'utf8');
const lines = content.split('\n');

// Find the start and end of the JavaScript section to externalize
let scriptStart = -1;
let scriptEnd = -1;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Find where the main script starts (after DOMContentLoaded line)
    if (line.includes('document.addEventListener(\'DOMContentLoaded\', loadFlightData);')) {
        scriptStart = i + 1; // Start after this line
        continue;
    }
    
    // Find the end (before the last </script> closing tag)
    if (scriptStart > 0 && line.trim() === '</script>' && i > 2200) {
        scriptEnd = i;
        break;
    }
}

console.log(`Script starts at line: ${scriptStart + 1}`);
console.log(`Script ends at line: ${scriptEnd + 1}`);
console.log(`Total JavaScript lines: ${scriptEnd - scriptStart}`);

// Extract the JavaScript content
const jsLines = lines.slice(scriptStart, scriptEnd);

// Remove leading whitespace (8 spaces of indentation)
const cleanedJsLines = jsLines.map(line => {
    if (line.startsWith('        ')) {
        return line.substring(8);
    }
    return line;
});

console.log('\nFirst 10 lines of extracted JS:');
console.log(cleanedJsLines.slice(0, 10).join('\n'));

console.log('\nLast 10 lines of extracted JS:');
console.log(cleanedJsLines.slice(-10).join('\n'));

