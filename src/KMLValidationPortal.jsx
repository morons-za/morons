import { useState, useCallback } from 'react';
import './KMLValidationPortal.css';

// Dynamic backend URL - use current domain in production, localhost in development
const BACKEND_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:4000'
  : window.location.origin;

function KMLValidationPortal() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  const onDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter(file => 
        file.name.toLowerCase().endsWith('.kml')
      );
      setFiles(prev => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files).filter(file => 
      file.name.toLowerCase().endsWith('.kml')
    );
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setFiles([]);
    setResults([]);
  };

  const handleRescanMetadata = async () => {
    setRescanning(true);
    try {
      // Since the validation portal doesn't have admin access,
      // we'll provide instructions for manual refresh
      alert(`🔧 Admin Tools Location:

The "Refresh Metadata" button is now located in the main tools section at the top of the page!

**How to find it:**
1. Go to the main page (click "Home" in the top menu)
2. Look in the "Tools and filters" section (below the map)
3. Click "Show Filters" if needed
4. You'll see a green "🔄 Refresh Metadata" button

**Alternative methods:**
- Refresh your browser page
- Restart the server (Ctrl+C in terminal, then 'npm run backend')

The deleted file should disappear from the frontend after refreshing!`);
    } catch (error) {
      console.error('Rescan failed:', error);
      alert(`❌ Error: ${error.message}`);
    } finally {
      setRescanning(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || uploading) return; // Prevent double submission
    
    setUploading(true);
    const formData = new FormData();
    files.forEach(file => formData.append('kml', file));
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/validate-kml`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setResults(data.results);
      
      // Clear files after successful upload
      setFiles([]);
      
      // Show success message with cache clearing info
      if (data.summary.saved > 0) {
        alert(`✅ Successfully processed ${data.summary.saved} violating flight(s)!\n\nFiles have been renamed, PNG maps generated, and metadata updated.\n\nThe flights should now appear in your main tracking interface.`);
      }
      
    } catch (error) {
      console.error('Upload failed:', error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'VIOLATION_DETECTED':
        return '✅';
      case 'NO_VIOLATIONS':
        return '❌';
      case 'INVALID':
        return '⚠️';
      case 'ERROR':
        return '🚨';
      case 'DUPLICATE_SKIPPED':
        return '⏭️';
      default:
        return '❓';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'VIOLATION_DETECTED':
        return '#28a745';
      case 'NO_VIOLATIONS':
        return '#6c757d';
      case 'INVALID':
        return '#ffc107';
      case 'ERROR':
        return '#dc3545';
      case 'DUPLICATE_SKIPPED':
        return '#17a2b8';
      default:
        return '#6c757d';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'VIOLATION_DETECTED':
        return 'VIOLATION DETECTED (Saved)';
      case 'NO_VIOLATIONS':
        return 'No violations (Rejected)';
      case 'INVALID':
        return 'Invalid file';
      case 'ERROR':
        return 'Processing error';
      case 'DUPLICATE_SKIPPED':
        return 'Duplicate (Skipped)';
      default:
        return status;
    }
  };

  return (
    <div className="validation-portal">
      <div className="portal-header">
        <h1>🚁 KML Validation Portal</h1>
        <p>Upload KML files to check for TMNP airspace violations. Only violating flights will be saved.</p>
      </div>

      {/* File Upload Section */}
      <div className="upload-section">
        <div 
          className={`dropzone ${dragActive ? 'drag-active' : ''}`}
          onDragEnter={onDrag}
          onDragLeave={onDrag}
          onDragOver={onDrag}
          onDrop={onDrop}
        >
          <div className="dropzone-content">
            <div className="dropzone-icon">📁</div>
            <h3>Drag & Drop KML Files Here</h3>
            <p>or</p>
            <label className="file-input-label">
              Choose Files
              <input
                type="file"
                multiple
                accept=".kml"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </label>
            <p className="dropzone-hint">Supports multiple KML files (max 20)</p>
          </div>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="file-list">
            <div className="file-list-header">
              <h3>Selected Files ({files.length})</h3>
              <button onClick={clearAllFiles} className="clear-btn">
                Clear All
              </button>
            </div>
            {files.map((file, index) => (
              <div key={index} className="file-item">
                <span className="file-name">{file.name}</span>
                <span className="file-size">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                <button 
                  onClick={() => removeFile(index)} 
                  className="remove-btn"
                  title="Remove file"
                >
                  ✕
                </button>
              </div>
            ))}
            <button 
              onClick={handleUpload} 
              disabled={uploading || files.length === 0}
              className="validate-btn"
            >
              {uploading ? 'Validating...' : `Validate ${files.length} File${files.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Results Section */}
      {results.length > 0 && (
        <div className="results-section">
          <h2>Validation Results</h2>
          
          {/* Summary */}
          <div className="results-summary">
            <div className="summary-item">
              <span className="summary-label">Total Files:</span>
              <span className="summary-value">{results.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Saved:</span>
              <span className="summary-value saved">{results.filter(r => r.saved).length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Rejected:</span>
              <span className="summary-value rejected">{results.filter(r => !r.saved && r.status !== 'ERROR' && r.status !== 'DUPLICATE_SKIPPED').length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Duplicates:</span>
              <span className="summary-value duplicates">{results.filter(r => r.status === 'DUPLICATE_SKIPPED').length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Errors:</span>
              <span className="summary-value errors">{results.filter(r => r.status === 'ERROR').length}</span>
            </div>
          </div>

          {/* Detailed Results */}
          <div className="results-list">
            {results.map((result, index) => (
              <div key={index} className={`result-item ${result.saved ? 'saved' : 'rejected'}`}>
                <div className="result-header">
                  <span className="result-icon">{getStatusIcon(result.status)}</span>
                  <span className="result-filename">{result.filename}</span>
                  <span 
                    className="result-status"
                    style={{ color: getStatusColor(result.status) }}
                  >
                    {getStatusText(result.status)}
                  </span>
                </div>
                
                {result.registration && (
                  <div className="result-details">
                    <span><strong>Registration:</strong> {result.registration}</span>
                    {result.date && <span><strong>Date:</strong> {result.date}</span>}
                    {result.time && <span><strong>Time:</strong> {result.time}</span>}
                    {result.newFilename && <span><strong>New Filename:</strong> {result.newFilename}</span>}
                    {result.pngGenerated && <span style={{color: '#28a745'}}><strong>✅ PNG Generated</strong></span>}
                  </div>
                )}
                
                {result.error && (
                  <div className="result-error">
                    <strong>Error:</strong> {result.error}
                  </div>
                )}
                
                {result.status === 'DUPLICATE_SKIPPED' && (
                  <div className="result-duplicate" style={{color: '#17a2b8', fontStyle: 'italic'}}>
                    <strong>Duplicate Info:</strong> {result.details}
                    {result.existingFile && <span><br/><strong>Existing File:</strong> {result.existingFile}</span>}
                  </div>
                )}
                
                {result.violations && result.violations.length > 0 && (
                  <div className="result-violations">
                    <strong>Violations:</strong> {result.violations.length} point(s) in TMNP airspace
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="instructions">
        <h3>How it works:</h3>
        <ol>
          <li><strong>Upload KML files</strong> - Drag & drop or browse to select multiple KML files</li>
          <li><strong>Automatic validation</strong> - System checks if flights enter TMNP restricted airspace</li>
          <li><strong>Complete processing</strong> - Violating flights are automatically renamed, PNG maps generated, and metadata updated</li>
          <li><strong>Ready to use</strong> - Flights immediately appear in your main tracking interface with full functionality</li>
        </ol>
        
        <div className="security-note">
          <strong>🔒 Security Note:</strong> This validation endpoint is local-only and cannot be accessed from external networks.
        </div>
        
        <div style={{ marginTop: '20px', padding: '16px', background: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#495057' }}>🔄 Metadata Management</h4>
          <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#6c757d' }}>
            If you've manually deleted files or need to refresh the system's metadata, use the rescan button below.
          </p>
          <button 
            onClick={handleRescanMetadata}
            disabled={rescanning}
            style={{ 
              padding: '8px 16px', 
              borderRadius: '6px', 
              background: '#007bff', 
              color: '#fff', 
              border: 'none', 
              fontWeight: '600', 
              fontSize: '14px', 
              cursor: rescanning ? 'not-allowed' : 'pointer',
              opacity: rescanning ? 0.6 : 1
            }}
          >
            {rescanning ? '🔄 Loading...' : '📋 Where to Find Admin Tools'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default KMLValidationPortal; 