# GitHub Deployment System

This system automates the process of deploying new helicopter flight data (KML files, PNG maps) to GitHub, removing the need for manual Git commands.

## Features

- **One-Click Deployment**: Deploy all new files with a single button click in the admin interface
- **Automatic File Detection**: Scans for new KML files, PNG maps, and optimized files
- **Progress Tracking**: Real-time progress updates with visual progress bar
- **Smart Commit Messages**: Automatically generates commit messages with helicopter registrations
- **Error Handling**: Comprehensive error handling and reporting
- **Configuration**: Customizable settings via configuration file

## Usage

### 1. Admin Interface (Recommended)

1. Start the admin server: `./launch.sh` or `node scripts/index-no-auth.cjs`
2. Open http://localhost:4000 in your browser
3. Process your KML files using the existing workflow
4. Click the **🚀 Deploy to GitHub** button
5. Watch the deployment progress in real-time

### 2. Command Line

```bash
# Deploy from project root
node backend/scripts/deploy-to-github.cjs

# Or make it executable and run directly
./backend/scripts/deploy-to-github.cjs
```

## How It Works

1. **File Scanning**: Scans these directories for new/modified files:
   - `backend/uploads/` (original KML files)
   - `backend/flight-maps/` (PNG violation maps)
   - `static-site/kml-optimised/` (optimized KML files)

2. **Git Operations**: 
   - Adds files to Git staging area
   - Creates a commit with auto-generated message
   - Pushes to the configured remote repository

3. **Status Tracking**: Provides real-time updates through:
   - Admin interface progress bar
   - Console output with colored logging
   - Log file (`backend/deployment.log`)

## Configuration

Edit `backend/deployment-config.json` to customize settings:

```json
{
  "git": {
    "remote": "origin",
    "branch": "main",
    "commitMessageTemplate": "Add new helicopter violations: {registrations}",
    "maxFilesPerCommit": 50,
    "timeout": 300000
  }
}
```

## Prerequisites

- Git repository properly configured with remote
- SSH/HTTPS access to GitHub repository
- Node.js dependencies installed (`npm install`)

## Troubleshooting

### Common Issues

1. **"Git repository check failed"**
   - Ensure you're in a Git repository
   - Check that the remote 'origin' exists: `git remote -v`

2. **"Authentication failed"**
   - Set up SSH keys or GitHub token
   - Test with: `git push origin main`

3. **"No new files found"**
   - Files are already committed
   - Check `git status` to see untracked files

### Logs

- **Deployment logs**: `backend/deployment.log`
- **Status file**: `backend/deployment-status.json`
- **Console output**: Colored output in terminal

### Manual Git Commands (Fallback)

If automated deployment fails, you can still deploy manually:

```bash
# Add new files
git add backend/uploads/ backend/flight-maps/ static-site/kml-optimised/

# Commit with message
git commit -m "Add new helicopter violations: [registrations]"

# Push to GitHub
git push origin main
```

## File Structure

```
backend/
├── scripts/
│   ├── deploy-to-github.cjs      # Main deployment script
│   └── deployment-logger.cjs     # Logging utility
├── deployment-config.json        # Configuration file
├── deployment.log               # Log file (created automatically)
└── deployment-status.json      # Status file (created automatically)
```

## Security Notes

- The script only adds files in the predefined directories
- No sensitive information is logged
- Status file contains only deployment progress information
- All Git operations are performed with existing user credentials

## Integration

This system integrates seamlessly with the existing KML processing workflow:

1. Upload KML files → Process → Generate PNGs → Optimize → **Deploy to GitHub**
2. All deployment operations are logged and can be monitored through the admin interface
3. Non-technical users can deploy changes without knowing Git commands

## Support

For issues or questions:
- Check the log files first: `backend/deployment.log`
- Verify Git repository status: `git status`
- Test manual Git operations to isolate the issue