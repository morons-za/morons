#!/bin/bash

# List of PNG files to regenerate (extract just the base filenames)
png_files=(
    "2025-05-17-ZS-HMB-bd0d829b"
    "2025-10-02-UNKNOWN-EGM96"
    "2025-08-25-ZS-HMB-3be6c880"
    "2025-08-24-ZT-HOT-3be1a545"
    "2025-08-24-ZS-HBO-3be1a572"
    "2025-08-23-ZS-HBO-3bddfd47"
    "2025-08-22-ZS-RTG-3bda2cb6"
    "2025-08-22-ZS-HBO-3bd9cf37"
    "2025-08-21-ZT-HOT-3bd5fa78"
    "2025-08-21-ZS-RTG-3bd5e722"
    "2025-08-19-ZT-HOT-3bcefe9a"
    "2025-08-19-ZT-HOT-3bce8cb6"
    "2025-08-19-ZS-HBO-3bce80f0"
    "2025-07-09-ZS-KUI-3b2bbc77"
    "2025-06-05-ZS-KUI-3aa81789"
    "2025-09-14-ZS-HMB-e4f2a9ff"
    "2025-07-31-ZT-HOT-test"
)

echo "🔧 Starting PNG regeneration for ${#png_files[@]} files..."
echo "📁 Looking for KML files in: /Users/werner/Dev/heli/heli-map/backend/uploads/"

successful=0
failed=0
not_found=0

for base_name in "${png_files[@]}"; do
    kml_file="${base_name}.kml"
    kml_path="/Users/werner/Dev/heli/heli-map/backend/uploads/${kml_file}"
    
    echo ""
    echo "🔍 Processing: ${base_name}"
    
    if [ -f "$kml_path" ]; then
        echo "✅ Found KML: $kml_file"
        echo "🚁 Regenerating PNG..."
        
        if node generate-flight-image.cjs "$kml_file"; then
            echo "✅ Successfully regenerated: ${base_name}.png"
            ((successful++))
        else
            echo "❌ Failed to regenerate: ${base_name}.png"
            ((failed++))
        fi
    else
        echo "⚠️  KML file not found: $kml_file"
        ((not_found++))
    fi
done

echo ""
echo "📊 Results Summary:"
echo "✅ Successfully regenerated: $successful"
echo "❌ Failed: $failed"
echo "⚠️  Not found: $not_found"
echo "📁 Total processed: ${#png_files[@]}"

