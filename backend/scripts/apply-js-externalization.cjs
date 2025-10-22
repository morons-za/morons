// Script to apply JavaScript externalization to build-static-site.cjs
const fs = require('fs');
const path = require('path');

console.log('🔧 Applying JavaScript externalization to build-static-site.cjs...\n');

// Read the build script
const buildScriptPath = path.join(__dirname, 'build-static-site.cjs');
let content = fs.readFileSync(buildScriptPath, 'utf8');
const lines = content.split('\n');

// Find the inline script section that needs to be replaced
let scriptTagLine = -1;
let scriptEndLine = -1;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Find the <script src="./js/app.js"></script> line
    if (line.includes('<script src="./js/app.js"></script>')) {
        scriptTagLine = i;
    }
    
    // Find the next <script> tag after it
    if (scriptTagLine > 0 && i > scriptTagLine && line.trim() === '<script>') {
        // This is the inline script that needs to be minimized
        // Find its closing tag
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() === '</script>' && j > 2200) {
                scriptEndLine = j;
                break;
            }
        }
        break;
    }
}

if (scriptTagLine === -1 || scriptEndLine === -1) {
    console.error('❌ Could not find script section to replace');
    console.log(`scriptTagLine: ${scriptTagLine}, scriptEndLine: ${scriptEndLine}`);
    process.exit(1);
}

console.log(`📍 Found inline script section:`);
console.log(`   <script> at line: ${scriptTagLine + 2}`); // The line after <script src...>
console.log(`   </script> at line: ${scriptEndLine + 1}`);
console.log(`   Lines to replace: ${scriptEndLine - scriptTagLine - 1}\n`);

// Create the replacement content (minimal inline script)
const replacementLines = [
    '    <script>',
    '        // Initialize the application when DOM is ready',
    '        document.addEventListener(\'DOMContentLoaded\', loadFlightData);',
    '    </script>'
];

// Replace the inline script section
const newLines = [
    ...lines.slice(0, scriptTagLine + 1), // Everything up to and including <script src="./js/app.js">
    ...replacementLines,
    ...lines.slice(scriptEndLine + 1) // Everything after </script>
];

const newContent = newLines.join('\n');

// Write the modified build script
fs.writeFileSync(buildScriptPath, newContent);

console.log(`✅ Updated build-static-site.cjs`);
console.log(`   Removed: ${scriptEndLine - scriptTagLine - 1} lines of inline JavaScript`);
console.log(`   Added: ${replacementLines.length} lines (minimal initialization)`);
console.log(`\n🎉 JavaScript successfully externalized!`);
console.log(`\n📝 Next: Run the build script to generate the optimized static site`);

