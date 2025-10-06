#!/usr/bin/env python3
"""
KML Optimiser for Flight Tracking
Converts KML files with thousands of individual points to optimised LineString versions
"""

import os
import re
import xml.etree.ElementTree as ET
from pathlib import Path

def extract_coordinates_from_kml(kml_content):
    """Extract all coordinates from KML points and return as LineString coordinates
    Supports both standard KML <coordinates> and Google Earth Extended <gx:coord> formats
    """
    coordinates = []
    
    # Method 1: Standard KML format with <coordinates> elements
    coordinate_pattern = r'<coordinates>([^<]+)</coordinates>'
    matches = re.findall(coordinate_pattern, kml_content)
    
    for match in matches:
        coord_str = match.strip()
        if coord_str:
            coordinates.append(coord_str)
    
    # Method 2: Google Earth Extended format with <gx:coord> elements
    if not coordinates:
        gx_coord_pattern = r'<gx:coord[^>]*>([^<]+)</gx:coord>'
        gx_matches = re.findall(gx_coord_pattern, kml_content)
        
        # Convert gx:coord format ("lon lat alt") to KML coordinates format ("lon,lat,alt")
        for match in gx_matches:
            coord_parts = match.strip().split()
            if len(coord_parts) >= 2:  # At least longitude and latitude
                # Convert "18.427323 -33.90097 22" to "18.427323,-33.90097,22"
                if len(coord_parts) >= 3:
                    coord_str = f"{coord_parts[0]},{coord_parts[1]},{coord_parts[2]}"
                else:
                    coord_str = f"{coord_parts[0]},{coord_parts[1]},0"
                coordinates.append(coord_str)
    
    return coordinates

def get_flight_info(kml_content):
    """Extract flight registration and basic info from KML"""
    # Try to extract registration from filename pattern or KML content
    name_match = re.search(r'<name>([^<]+)</name>', kml_content)
    flight_name = name_match.group(1) if name_match else "Flight Path"
    
    # Try to extract description
    desc_match = re.search(r'<description><!\[CDATA\[(.*?)\]\]></description>', kml_content, re.DOTALL)
    description = desc_match.group(1) if desc_match else "Optimized flight path"
    
    return flight_name, description

def create_optimised_kml(original_kml_path, decimation_factor=5):
    """Convert KML with individual points to LineString KML"""
    
    with open(original_kml_path, 'r', encoding='utf-8') as f:
        kml_content = f.read()
    
    # Extract coordinates
    coordinates = extract_coordinates_from_kml(kml_content)
    
    if not coordinates:
        print(f"No coordinates found in {original_kml_path}")
        return None
    
    # Detect which format was used (for debugging)
    format_type = "Standard KML" if '<coordinates>' in kml_content else "Google Earth Extended (gx:coord)"
    
    # Decimate coordinates (take every Nth point for performance)
    decimated_coords = coordinates[::decimation_factor]
    
    # Get flight info
    flight_name, description = get_flight_info(kml_content)
    
    # Create optimised KML with LineString
    optimised_kml = f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>{flight_name} - Optimised</name>
    <description><![CDATA[Optimised flight path with {len(decimated_coords)} points (decimated from {len(coordinates)} original points). Source format: {format_type}]]></description>
    
    <Style id="flightPath">
      <LineStyle>
        <color>ff0000ff</color>
        <width>3</width>
      </LineStyle>
    </Style>
    
    <Placemark>
      <name>Flight Path</name>
      <description><![CDATA[{description}]]></description>
      <styleUrl>#flightPath</styleUrl>
      <LineString>
        <extrude>1</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>
          {' '.join(decimated_coords)}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>'''
    
    return optimised_kml

def optimise_kml_files(input_dir, output_dir, max_files=None):
    """Process KML files and create optimised versions"""
    
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    kml_files = list(input_path.glob("*.kml"))
    
    total_files = len(kml_files)
    files_to_process = total_files if max_files is None else min(max_files, total_files)
    
    print(f"Found {total_files} KML files")
    print(f"Processing {'all' if max_files is None else files_to_process} files...")
    print("\nProgress:")
    
    processed = 0
    total_original_size = 0
    total_optimised_size = 0
    
    files_to_iterate = kml_files if max_files is None else kml_files[:max_files]
    
    for i, kml_file in enumerate(files_to_iterate, 1):
        # Progress indicator
        progress = i / len(files_to_iterate) * 100
        print(f"[{i:3d}/{len(files_to_iterate)}] ({progress:5.1f}%) Processing {kml_file.name}...", end="")
        
        try:
            optimised_content = create_optimised_kml(kml_file)
            
            if optimised_content:
                # Create output filename with -opt suffix
                output_filename = kml_file.stem + "-opt.kml"
                output_file = output_path / output_filename
                
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(optimised_content)
                
                # Get file sizes for comparison
                original_size = kml_file.stat().st_size / 1024 / 1024  # MB
                optimised_size = output_file.stat().st_size / 1024 / 1024  # MB
                
                total_original_size += original_size
                total_optimised_size += optimised_size
                
                # Determine format type for logging
                file_format = "GX" if '<gx:coord' in open(kml_file, 'r', encoding='utf-8').read() else "STD"
                print(f" ✓ {original_size:.1f}MB -> {optimised_size:.2f}MB [{file_format}]")
                processed += 1
            
        except Exception as e:
            print(f" ✗ Error: {e}")
    
    # Summary statistics
    print(f"\n" + "=" * 60)
    print(f"OPTIMISATION COMPLETE!")
    print(f"✓ Successfully processed: {processed}/{len(files_to_iterate)} files")
    print(f"📊 Total size reduction: {total_original_size:.1f} MB -> {total_optimised_size:.1f} MB")
    print(f"💾 Space saved: {total_original_size - total_optimised_size:.1f} MB ({(1-total_optimised_size/total_original_size)*100:.1f}% reduction)")
    print(f"📁 Optimised files location: {output_path}")
    return processed

if __name__ == "__main__":
    # Resolve paths relative to this script, allow env overrides
    base_dir = Path(__file__).parent
    default_input = base_dir.parent / 'uploads'  # backend/uploads
    default_output = base_dir.parent.parent / 'static-site' / 'kml-optimised'
    input_directory = os.environ.get('UPLOADS_DIR', str(default_input))
    output_directory = os.environ.get('OUTPUT_DIR', str(default_output))
    
    print("KML Optimiser - Converting point-based KML to LineString KML")
    print("=" * 60)
    
    # Process files
    optimise_kml_files(input_directory, output_directory)  # Process ALL files
    
    print("\nNext steps:")
    print("1. Update your production HTML to use -opt.kml files for map display")
    print("2. Keep original .kml files for downloads")
    print("3. Deploy both directories to your web server")
