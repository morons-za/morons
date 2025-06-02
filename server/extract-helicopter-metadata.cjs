const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const uploadsDir = path.join(__dirname, 'uploads');
const outputFile = path.join(__dirname, 'helicopters.json');

function extractKmlInfoFromFile(filePath) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    let registration = '';
    let owner = '';
    let imageUrl = '';
    
    // Registration: extract from <n> tag (e.g. -/ZSHBO) - XML parser converts this to <name>
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    if (doc && doc.name) {
      // Extract the last part after the slash
      const regMatch = doc.name.match(/([A-Z0-9]{5})$/);
      if (regMatch) {
        // Convert ZSHMB format to ZS-HMB format (preserve the original prefix)
        const reg = regMatch[1];
        registration = reg.slice(0, 2) + '-' + reg.slice(2);
      }
    }
    
    // Extract image URL and owner from description (HTML)
    if (doc && doc.description) {
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      
      // Extract image URL
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) imageUrl = imgMatch[1];
      
      // Extract owner: find first <div ...>...</div>, then text after <br/>
      const divMatch = desc.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
      if (divMatch) {
        const divContent = divMatch[1];
        const brSplit = divContent.split(/<br\/?\s*>/i);
        if (brSplit.length > 1) {
          owner = brSplit[1].replace(/<[^>]+>/g, '').trim();
        }
      }
    }
    
    return { registration, owner, imageUrl };
  } catch (e) {
    console.error(`Error processing file: ${filePath}`, e.message);
    return { registration: '', owner: '', imageUrl: '' };
  }
}

// Process all KML files
const files = fs.readdirSync(uploadsDir).filter(f => f.toLowerCase().endsWith('.kml'));
const helicopters = {};

console.log(`Processing ${files.length} KML files...`);

files.forEach((filename, index) => {
  const filePath = path.join(uploadsDir, filename);
  const meta = extractKmlInfoFromFile(filePath);
  
  if (meta.registration) {
    helicopters[meta.registration] = {
      registration: meta.registration,
      owner: meta.owner,
      imageUrl: meta.imageUrl
    };
    
    if (index % 50 === 0) {
      console.log(`Processed ${index + 1}/${files.length} files...`);
    }
  }
});

// Write to JSON file
fs.writeFileSync(outputFile, JSON.stringify(helicopters, null, 2));
console.log(`✅ Extracted metadata for ${Object.keys(helicopters).length} helicopters to helicopters.json`);

// Show a sample
const samples = Object.keys(helicopters).slice(0, 3);
console.log('\n📄 Sample data:');
samples.forEach(reg => {
  console.log(`${reg}: ${helicopters[reg].owner} | ${helicopters[reg].imageUrl ? 'Has image' : 'No image'}`);
}); 