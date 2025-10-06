const fs = require('fs');
const path = require('path');

class FrontendParser {
    constructor(projectRoot = null) {
        this.projectRoot = projectRoot || path.resolve(__dirname, '../..');
        this.staticSiteIndex = path.join(this.projectRoot, 'static-site', 'index.html');
    }

    /**
     * Parse embedded flight data from static site index.html
     */
    async parseFrontendFlightData() {
        try {
            if (!fs.existsSync(this.staticSiteIndex)) {
                return {
                    success: false,
                    error: 'Static site index.html not found',
                    count: 0,
                    flights: [],
                    lastModified: null
                };
            }

            const htmlContent = fs.readFileSync(this.staticSiteIndex, 'utf8');
            const stats = fs.statSync(this.staticSiteIndex);

            // Extract embedded flight data
            // Use a more sophisticated pattern that handles escaped quotes
            const embeddedDataMatch = htmlContent.match(/window\.embeddedFlightData\s*=\s*"((?:[^\\"]|\\.)*)"/);
            
            if (!embeddedDataMatch) {
                return {
                    success: false,
                    error: 'No embedded flight data found in static site',
                    count: 0,
                    flights: [],
                    lastModified: stats.mtime
                };
            }

            // The embedded data is a JSON string that's been escaped and embedded as a string
            const escapedJsonString = embeddedDataMatch[1];
            
            try {
                // The data is double-encoded JSON: first unescape, then parse
                let flightData;
                
                try {
                    // Unescape the JSON string first
                    const unescapedString = escapedJsonString
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\');
                    
                    // Parse the unescaped JSON string
                    flightData = JSON.parse(unescapedString);
                } catch (parseError) {
                    // Fallback: try parsing the raw string in case it's not double-escaped
                    flightData = JSON.parse(escapedJsonString);
                }
                
                // If result is still a string, parse it again (triple-encoded case)
                if (typeof flightData === 'string') {
                    flightData = JSON.parse(flightData);
                }
                
                if (!Array.isArray(flightData)) {
                    throw new Error(`Parsed data is not an array, got: ${typeof flightData}`);
                }

                return {
                    success: true,
                    count: flightData.length,
                    flights: flightData,
                    lastModified: stats.mtime,
                    sampleFlights: flightData.slice(0, 3).map(f => ({
                        filename: f.filename,
                        registration: f.registration,
                        date: f.date
                    }))
                };

            } catch (parseError) {
                return {
                    success: false,
                    error: `Failed to parse embedded flight data: ${parseError.message}`,
                    count: 0,
                    flights: [],
                    lastModified: stats.mtime
                };
            }

        } catch (error) {
            return {
                success: false,
                error: `Failed to read static site: ${error.message}`,
                count: 0,
                flights: [],
                lastModified: null
            };
        }
    }

    /**
     * Get backend flight count from master metadata
     */
    async getBackendFlightCount() {
        try {
            const masterMetadataPath = path.join(this.projectRoot, 'backend', 'server', 'master-metadata.json');
            
            if (!fs.existsSync(masterMetadataPath)) {
                return {
                    success: false,
                    error: 'Backend master-metadata.json not found',
                    count: 0,
                    lastModified: null
                };
            }

            const stats = fs.statSync(masterMetadataPath);
            const metadataContent = fs.readFileSync(masterMetadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);

            // Handle both array format and object format
            let flights;
            if (Array.isArray(metadata)) {
                flights = metadata;
            } else if (metadata.flights && Array.isArray(metadata.flights)) {
                flights = metadata.flights;
            } else {
                throw new Error('Invalid metadata format: expected array or object with flights array');
            }

            return {
                success: true,
                count: flights.length,
                lastModified: stats.mtime,
                sampleFlights: flights.slice(0, 3).map(f => ({
                    filename: f.filename,
                    registration: f.registration,
                    date: f.date
                }))
            };

        } catch (error) {
            return {
                success: false,
                error: `Failed to read backend metadata: ${error.message}`,
                count: 0,
                lastModified: null
            };
        }
    }

    /**
     * Compare backend and frontend flight data
     */
    async compareFlightData() {
        const backend = await this.getBackendFlightCount();
        const frontend = await this.parseFrontendFlightData();

        const comparison = {
            backend,
            frontend,
            isHealthy: false,
            mismatch: 0,
            healthScore: 0,
            issues: [],
            suggestions: []
        };

        // Calculate mismatch
        if (backend.success && frontend.success) {
            comparison.mismatch = backend.count - frontend.count;
            comparison.isHealthy = comparison.mismatch === 0;
        }

        // Identify issues
        if (!backend.success) {
            comparison.issues.push(`Backend Error: ${backend.error}`);
            comparison.suggestions.push('Refresh Metadata to rebuild backend data');
        }

        if (!frontend.success) {
            comparison.issues.push(`Frontend Error: ${frontend.error}`);
            comparison.suggestions.push('Build Static Site to regenerate frontend');
        }

        if (backend.success && frontend.success) {
            if (comparison.mismatch > 0) {
                comparison.issues.push(`${comparison.mismatch} flights missing from frontend`);
                comparison.suggestions.push('Build Static Site to include missing flights');
            } else if (comparison.mismatch < 0) {
                comparison.issues.push(`${Math.abs(comparison.mismatch)} extra flights in frontend`);
                comparison.suggestions.push('Refresh Metadata then Build Static Site');
            }

            // Check if frontend is stale
            if (backend.lastModified && frontend.lastModified) {
                const backendTime = new Date(backend.lastModified).getTime();
                const frontendTime = new Date(frontend.lastModified).getTime();
                const timeDiffMinutes = (backendTime - frontendTime) / (1000 * 60);

                if (timeDiffMinutes > 30) { // Frontend is more than 30 minutes older
                    comparison.issues.push(`Frontend is ${Math.round(timeDiffMinutes)} minutes older than backend data`);
                    comparison.suggestions.push('Build Static Site to update with latest data');
                }
            }
        }

        // Calculate health score
        let score = 0;
        if (backend.success) score += 40;
        if (frontend.success) score += 40;
        if (comparison.mismatch === 0) score += 20;
        comparison.healthScore = score;

        return comparison;
    }

    /**
     * Get a summary health status
     */
    async getHealthSummary() {
        const comparison = await this.compareFlightData();
        
        let status = 'healthy';
        let statusIcon = '✅';
        let statusColor = 'success';

        if (comparison.issues.length > 0) {
            if (comparison.healthScore < 50) {
                status = 'critical';
                statusIcon = '❌';
                statusColor = 'error';
            } else {
                status = 'warning';
                statusIcon = '⚠️';
                statusColor = 'warning';
            }
        }

        return {
            ...comparison,
            status,
            statusIcon,
            statusColor,
            summary: comparison.isHealthy ? 
                'All systems healthy - Backend and frontend are in sync' :
                `${comparison.issues.length} issue(s) detected - ${comparison.suggestions.length} suggestion(s) available`
        };
    }
}

module.exports = FrontendParser;