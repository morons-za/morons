const fs = require('fs').promises;
const path = require('path');

class DeploymentLogger {
    constructor(logFilePath = null) {
        this.logFile = logFilePath || path.join(__dirname, '..', 'logs', 'deployment.log');
        this.enabled = true;
    }

    async log(level, message, data = null) {
        if (!this.enabled) return;

        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...(data && { data })
        };

        const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${data ? ` | ${JSON.stringify(data)}` : ''}\n`;
        
        try {
            // Write to file
            await fs.appendFile(this.logFile, logLine);
            
            // Also log to console with colors
            this.logToConsole(level, message, data);
        } catch (error) {
            console.warn('Failed to write to log file:', error.message);
            this.logToConsole(level, message, data);
        }
    }

    logToConsole(level, message, data) {
        const colors = {
            info: '\x1b[36m',    // cyan
            warn: '\x1b[33m',    // yellow
            error: '\x1b[31m',   // red
            success: '\x1b[32m', // green
            debug: '\x1b[90m'    // gray
        };
        const reset = '\x1b[0m';
        const color = colors[level] || '';
        
        console.log(`${color}[DEPLOY-${level.toUpperCase()}]${reset} ${message}`);
        if (data) {
            console.log(`${color}[DATA]${reset}`, data);
        }
    }

    async info(message, data) {
        await this.log('info', message, data);
    }

    async warn(message, data) {
        await this.log('warn', message, data);
    }

    async error(message, data) {
        await this.log('error', message, data);
    }

    async success(message, data) {
        await this.log('success', message, data);
    }

    async debug(message, data) {
        await this.log('debug', message, data);
    }

    async clearLog() {
        try {
            await fs.writeFile(this.logFile, '');
            await this.info('Log file cleared');
        } catch (error) {
            console.warn('Failed to clear log file:', error.message);
        }
    }

    async getRecentLogs(lines = 100) {
        try {
            const content = await fs.readFile(this.logFile, 'utf8');
            const logLines = content.split('\n').filter(line => line.trim());
            return logLines.slice(-lines);
        } catch (error) {
            return [];
        }
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }
}

module.exports = DeploymentLogger;