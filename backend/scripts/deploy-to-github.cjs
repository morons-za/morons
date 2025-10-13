#!/usr/bin/env node

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const DeploymentLogger = require('./deployment-logger.cjs');

class GitDeployer {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '../..');
        this.logger = new DeploymentLogger(path.join(this.projectRoot, 'backend/deployment.log'));
        this.config = {
            remote: 'origin',
            branch: 'main',
            commitMessageTemplate: 'Add new helicopter violations: {registrations}',
            maxFilesPerCommit: 50,
            timeout: 300000 // 5 minutes
        };
        
        // Try to load config file
        try {
            const configPath = path.join(this.projectRoot, 'backend/config/deployment-config.json');
            const configJson = require(configPath);
            if (configJson && configJson.git) {
                this.config = { ...this.config, ...configJson.git };
            }
        } catch (e) {
            // optional config
        }
        
        this.status = {
            stage: 'idle',
            message: '',
            progress: 0,
            error: null,
            filesProcessed: 0,
            totalFiles: 0
        };
    }

    async updateStatus(stage, message, progress = null, error = null) {
        this.status = {
            ...this.status,
            stage,
            message,
            progress: progress !== null ? progress : this.status.progress,
            error
        };
        
        // Log status changes
        if (error) {
            await this.logger.error(`${stage}: ${message}`, { error });
        } else if (stage === 'complete') {
            await this.logger.success(`${stage}: ${message}`, { progress });
        } else {
            await this.logger.info(`${stage}: ${message}`, { progress });
        }
        
        console.log(`[${stage.toUpperCase()}] ${message}`);
        
        // Write status to file for API access
        try {
            await fs.writeFile(
                path.join(this.projectRoot, 'backend/config/deployment-status.json'),
                JSON.stringify(this.status, null, 2)
            );
        } catch (err) {
            console.warn('Failed to write status file:', err.message);
        }
    }

    async execCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Command timed out: ${command}`));
            }, options.timeout || this.config.timeout);

            exec(command, { 
                cwd: this.projectRoot,
                maxBuffer: 1024 * 1024 * 10, // 10MB buffer
                ...options 
            }, (error, stdout, stderr) => {
                clearTimeout(timeout);
                if (error) {
                    reject(new Error(`Command failed: ${command}\n${error.message}\n${stderr}`));
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    async checkGitStatus() {
        await this.updateStatus('checking', 'Checking Git repository status...');
        
        try {
            // Check if we're in a Git repository
            await this.execCommand('git rev-parse --git-dir');
            
            // Check if remote exists
            await this.execCommand(`git remote get-url ${this.config.remote}`);
            
            // Check current branch
            const currentBranch = await this.execCommand('git branch --show-current');
            console.log(`Current branch: ${currentBranch}`);
            
            return true;
        } catch (error) {
            throw new Error(`Git repository check failed: ${error.message}`);
        }
    }

    async getNewFiles() {
        await this.updateStatus('scanning', 'Scanning for new files...');
        
        const filePaths = [
            'backend/uploads/',
            'backend/flight-maps/',
            'static-site/kml-optimised/'
        ];
        
        const newFiles = [];
        
        for (const filePath of filePaths) {
            try {
                const fullPath = path.join(this.projectRoot, filePath);
                const gitStatus = await this.execCommand(`git status --porcelain "${fullPath}"`);
                
                if (gitStatus) {
                    const lines = gitStatus.split('\n').filter(line => line.trim());
                    for (const line of lines) {
                        const status = line.substring(0, 2);
                        const file = line.substring(3);
                        
                        // Include new files (??) and modified files (M)
                        if (status.includes('?') || status.includes('M') || status.includes('A')) {
                            newFiles.push({
                                path: file,
                                status: status.trim(),
                                type: this.getFileType(file)
                            });
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to check status for ${filePath}:`, error.message);
            }
        }
        
        return newFiles;
    }

    getFileType(filePath) {
        if (filePath.includes('uploads/') && filePath.endsWith('.kml')) return 'kml-original';
        if (filePath.includes('flight-maps/') && filePath.endsWith('.png')) return 'png-map';
        if (filePath.includes('kml-optimised/') && filePath.endsWith('.kml')) return 'kml-optimised';
        return 'other';
    }

    extractRegistrationsFromFiles(files) {
        const registrations = new Set();
        
        files.forEach(file => {
            const fileName = path.basename(file.path);
            // Extract registration from filename patterns like: ZS-HBO_2024-03-15_violation.kml
            const match = fileName.match(/([A-Z]{1,2}-[A-Z0-9]{2,4})/);
            if (match) {
                registrations.add(match[1]);
            }
        });
        
        return Array.from(registrations).sort();
    }

    async commitFiles(files) {
        if (files.length === 0) {
            await this.updateStatus('complete', 'No new files to commit');
            return { success: true, message: 'No new files found' };
        }

        this.status.totalFiles = files.length;
        await this.updateStatus('adding', `Adding ${files.length} files to Git...`, 0);

        try {
            // Add files in batches
            const batches = [];
            for (let i = 0; i < files.length; i += this.config.maxFilesPerCommit) {
                batches.push(files.slice(i, i + this.config.maxFilesPerCommit));
            }

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const progress = Math.round(((i + 1) / batches.length) * 40); // 40% for adding
                
                await this.updateStatus('adding', `Adding batch ${i + 1}/${batches.length} (${batch.length} files)...`, progress);
                
                // Add each file individually to handle any issues
                for (const file of batch) {
                    try {
                        await this.execCommand(`git add "${file.path}"`);
                        this.status.filesProcessed++;
                    } catch (error) {
                        console.warn(`Failed to add file ${file.path}:`, error.message);
                    }
                }
            }

            // Generate commit message
            const registrations = this.extractRegistrationsFromFiles(files);
            const commitMessage = this.config.commitMessageTemplate
                .replace('{registrations}', registrations.join(', '))
                .replace('{count}', files.length);

            await this.updateStatus('committing', `Committing ${files.length} files...`, 60);
            await this.execCommand(`git commit -m "${commitMessage}"`);

            await this.updateStatus('pushing', 'Pushing to GitHub...', 80);
            const pushResult = await this.execCommand(`git push ${this.config.remote} ${this.config.branch}`);

            await this.updateStatus('complete', `Successfully deployed ${files.length} files to GitHub`, 100);
            
            return {
                success: true,
                message: `Successfully deployed ${files.length} files`,
                registrations,
                commitMessage,
                pushResult
            };

        } catch (error) {
            await this.updateStatus('error', `Deployment failed: ${error.message}`, null, error.message);
            throw error;
        }
    }

    async deploy() {
        try {
            await this.updateStatus('starting', 'Starting deployment process...');
            
            // Check Git status
            await this.checkGitStatus();
            
            // Get new files
            const newFiles = await this.getNewFiles();
            
            if (newFiles.length === 0) {
                await this.updateStatus('complete', 'No new files to deploy', 100);
                return { success: true, message: 'No new files found' };
            }

            // Log file summary
            const summary = {};
            newFiles.forEach(file => {
                summary[file.type] = (summary[file.type] || 0) + 1;
            });
            
            console.log('Files to deploy:', summary);
            await this.updateStatus('preparing', `Found ${newFiles.length} new files to deploy`, 10);
            
            // Commit and push
            const result = await this.commitFiles(newFiles);
            return result;
            
        } catch (error) {
            await this.updateStatus('error', `Deployment failed: ${error.message}`, null, error.message);
            throw error;
        }
    }

    async getStatus() {
        return this.status;
    }
}

// CLI usage
if (require.main === module) {
    const deployer = new GitDeployer();
    
    deployer.deploy()
        .then(result => {
            console.log('Deployment completed successfully:', result);
            process.exit(0);
        })
        .catch(error => {
            console.error('Deployment failed:', error.message);
            process.exit(1);
        });
}

module.exports = GitDeployer;