const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const testFile = path.join(__dirname, 'uploads', '391f5174.kml');

function extractKmlInfoFromFile(filePath) {
  try {
    const xmlData = fs.readFileSync(filePath, 'utf8');
    console.log('✅ File read successfully');
    
    const parser = new XMLParser({ ignoreAttributes: false, processEntities: true });
    const xml = parser.parse(xmlData);
    console.log('✅ XML parsed successfully');
    
    let registration = '';
    let owner = '';
    let imageUrl = '';
    
    // Debug: show the structure
    const doc = xml.kml && xml.kml.Document ? xml.kml.Document : null;
    console.log('📄 Document keys:', doc ? Object.keys(doc) : 'No document');
    console.log('📄 n tag value:', doc ? doc.n : 'No n tag');
    console.log('📄 name tag value:', doc ? doc.name : 'No name tag');
    
    // Registration: extract from <n> tag (e.g. -/ZSHBO) - but it's actually <name>
    if (doc && doc.name) {
      console.log('🔍 Found name tag:', doc.name);
      // Extract the last part after the slash
      const regMatch = doc.name.match(/([A-Z0-9]{5})$/);
      console.log('🔍 Regex match:', regMatch);
      if (regMatch) {
        // Convert ZSHBO to ZT-HBO format
        const reg = regMatch[1];
        registration = `ZT-${reg.slice(2)}`; // ZSHBO -> ZT-HBO
        console.log('✅ Registration extracted:', registration);
      }
    }
    
    // Extract image URL and owner from description (HTML)
    if (doc && doc.description) {
      console.log('🔍 Found description, length:', doc.description.length);
      let desc = doc.description;
      desc = desc.replace(/^<!\[CDATA\[|\]\]>$/g, '');
      
      // Extract image URL
      const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) {
        imageUrl = imgMatch[1];
        console.log('✅ Image URL extracted:', imageUrl);
      }
      
      // Extract owner: find first <div ...>...</div>, then text after <br/>
      const divMatch = desc.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
      if (divMatch) {
        console.log('🔍 Found div content, extracting owner...');
        const divContent = divMatch[1];
        const brSplit = divContent.split(/<br\/?\s*>/i);
        if (brSplit.length > 1) {
          owner = brSplit[1].replace(/<[^>]+>/g, '').trim();
          console.log('✅ Owner extracted:', owner);
        }
      }
    }
    
    return { registration, owner, imageUrl };
  } catch (e) {
    console.error(`❌ Error processing file: ${filePath}`, e.message);
    return { registration: '', owner: '', imageUrl: '' };
  }
}

console.log('🧪 Testing KML extraction on single file...');
const result = extractKmlInfoFromFile(testFile);
console.log('\n📊 Final result:', result); 