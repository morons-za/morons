import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import omnivore from 'leaflet-omnivore'

// Fix Leaflet's default icon path for production
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/marker-icon-2x.png',
  iconUrl: '/marker-icon.png',
  shadowUrl: '/marker-shadow.png',
});

const CAPE_TOWN_LAT = -33.9249;
const CAPE_TOWN_LON = 18.4241;
const SEARCH_RADIUS_NM = 50; // nautical miles

// Dynamic backend URL - use current domain in production, localhost in development
const BACKEND_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:4000'
  : window.location.origin;

function isInTableMountainArea(lat, lon) {
  // Rough bounding box for Table Mountain National Park
  return lat >= -34.1 && lat <= -33.9 && lon >= 18.3 && lon <= 18.5
}

function utcToSaTime(date, time) {
  if (!date || !time) return '-';
  // date: '2025-05-03', time: '07:31'
  const utc = new Date(`${date}T${time}:00Z`);
  // South Africa is UTC+2
  const sa = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
  return sa.toISOString().slice(11, 16); // 'HH:MM'
}

// Selected Flight Row Component (replaces StickyFlightPanel)
function SelectedFlightSection({ flight, onClose, fileSize, onJumpToTable, onReport }) {
  if (!flight) return null;
  
  const kml = flight.kmlData || {};
  
  return (
    <div style={{
      background: '#f8f9fa',
      border: '1px solid #dee2e6',
      borderRadius: '8px',
      margin: '16px 0',
      overflow: 'hidden',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      {/* Header */}
      <div style={{
        background: '#e9ecef',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #dee2e6'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', color: '#495057' }}>
          Viewing Flight: {flight.registration || 'Unknown'}
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={onJumpToTable}
            style={{
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            title="Jump to table row"
          >
            📋 Jump to Table
          </button>
          <button
            onClick={onClose}
            style={{
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
            title="Close flight view"
          >
            ✕ Close
          </button>
        </div>
      </div>
      
      {/* Table Header */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>UTC Time</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>SA Time</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Registration</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'left' }}>Filename</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>KML</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>Size</th>
              <th style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>Take action</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: '#e6f7ff' }}>
              <td style={{ padding: '8px', border: '1px solid #ddd' }}>{flight.date || '-'}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd' }}>{flight.time || '-'}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd' }}>{utcToSaTime(flight.date, flight.time)}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd' }}>{flight.registration || '-'}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd' }}>{flight.filename || '-'}</td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                {kml.url ? (
                  <a href={`${BACKEND_URL}${kml.url}`} download={flight.filename} title="Download KML" style={{ fontSize: '1.3em', color: '#007bff', textDecoration: 'none', cursor: 'pointer' }}>
                    ⬇️
                  </a>
                ) : '-'}
              </td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                {fileSize ? `${fileSize} MB` : '-'}
              </td>
              <td style={{ padding: '8px', border: '1px solid #ddd', textAlign: 'center' }}>
                <button 
                  onClick={() => onReport && onReport(flight)} 
                  style={{ 
                    padding: '6px 12px', 
                    borderRadius: 4, 
                    background: '#dc3545', 
                    color: '#fff', 
                    border: 'none', 
                    cursor: 'pointer', 
                    fontSize: '18px',
                    fontWeight: '600'
                  }} 
                  title="Generate violation report"
                >
                  👮‍♂️
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Report Modal Component
function ReportModal({ isOpen, onClose, flightData }) {
  if (!isOpen || !flightData) return null;

  const registration = flightData.registration || 'UNKNOWN';
  const owner = flightData.owner || 'Private owner';
  const date = flightData.date || 'UNKNOWN DATE';
  
  const reportText = `It appears that a helicopter, registration ${registration} (${owner}), entered restricted NP17 airspace over Table Mountain on ${date}.`;
  
  // Generate flight map image path
  const imageFilename = flightData.filename ? flightData.filename.replace('.kml', '.png') : null;
  const imagePath = imageFilename ? `${BACKEND_URL}/flight-maps/${imageFilename}` : null;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      alert('Report text copied to clipboard!');
    } catch (err) {
      alert(`Report text:\n\n"${reportText}"\n\n(Please copy manually)`);
    }
  };

  const handleSaveImage = async () => {
    if (!imagePath) {
      alert('Flight map image not available');
      return;
    }
    
    try {
      // Show loading state
      const button = document.activeElement;
      const originalText = button.textContent;
      button.textContent = '⬇️ Downloading...';
      button.disabled = true;
      
      // Fetch the image as a blob
      const response = await fetch(imagePath);
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }
      
      const blob = await response.blob();
      
      // Create a blob URL and trigger download
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = imageFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the blob URL
      URL.revokeObjectURL(blobUrl);
      
      // Restore button state
      button.textContent = originalText;
      button.disabled = false;
      
      // Show success feedback
      const tempText = button.textContent;
      button.textContent = '✅ Downloaded!';
      setTimeout(() => {
        button.textContent = tempText;
      }, 2000);
      
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download image. Please try again.');
      
      // Restore button state on error
      const button = document.activeElement;
      button.textContent = '💾 Save Image';
      button.disabled = false;
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '600px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          borderBottom: '1px solid #eee',
          paddingBottom: '16px'
        }}>
          <h2 style={{ margin: 0, color: '#333' }}>Flight Violation Report</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#666',
              padding: '4px'
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Flight Map Image */}
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          {imagePath ? (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imagePath}
                alt={`Flight map for ${registration}`}
                style={{
                  width: '320px',
                  height: '320px',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  border: '1px solid #ddd'
                }}
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextElementSibling.style.display = 'block';
                }}
              />
              <div style={{ display: 'none', color: '#666', fontStyle: 'italic' }}>
                Flight map image not available
              </div>
              <button
                onClick={handleSaveImage}
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  padding: '6px 12px',
                  backgroundColor: 'rgba(40, 167, 69, 0.9)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '600',
                  backdropFilter: 'blur(4px)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }}
                title="Save flight map image"
              >
                💾 Save Image
              </button>
            </div>
          ) : (
            <div style={{ color: '#666', fontStyle: 'italic', padding: '40px' }}>
              Flight map image not available
            </div>
          )}
        </div>

        {/* Report Text */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid #dee2e6',
            marginBottom: '12px',
            fontFamily: 'monospace',
            fontSize: '14px',
            lineHeight: '1.5',
            textAlign: 'left',
            position: 'relative'
          }}>
            {reportText}
            <button
              onClick={handleCopyText}
              style={{
                position: 'absolute',
                bottom: '8px',
                right: '8px',
                padding: '4px 8px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600'
              }}
              title="Copy report text to clipboard"
            >
              📋 Copy text
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Report to SACAA */}
            <button
              onClick={() => {
                const mailtoUrl = `mailto:enforcement@caa.co.za?subject=Helicopter Airspace Violation Report - ${registration}&body=${encodeURIComponent(`Dear sir/madam,


It appears that a helicopter, registration ${registration} (${owner}), entered restricted airspace (NEMPAA NP17) over Table Mountain on ${date}. Please find a flight map here: ${imagePath ? imagePath.replace(/^https?:\/\/[^\/]+/, 'https://morons.onrender.com') : 'Flight map not available'}.


Could you please confirm receipt of my complaint and any relevant steps that might be taken? I greatly appreciate your assistance in the matter!


Regards,`)}`;
                window.open(mailtoUrl);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
              title="Report to South African Civil Aviation Authority"
            >
              ✈️ Report to SACAA
            </button>
            
            {/* Report to SanParks */}
            <button
              onClick={() => {
                const mailtoUrl = `mailto:TableM@sanparks.org?subject=Table Mountain Airspace Violation Report - ${registration}&body=${encodeURIComponent(`Dear sir/madam,


It appears that a helicopter, registration ${registration} (${owner}), entered restricted airspace (NEMPAA NP17) over Table Mountain on ${date}. Please find a flight map here: ${imagePath ? imagePath.replace(/^https?:\/\/[^\/]+/, 'https://morons.onrender.com') : 'Flight map not available'}.


Could you please confirm receipt of my complaint and any relevant steps that might be taken? I greatly appreciate your assistance in the matter!


Regards,`)}`;
                window.open(mailtoUrl);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
              title="Report to South African National Parks"
            >
              🏔️ Report to SanParks
            </button>
          </div>
          
          {/* Fallback email addresses */}
          <div style={{ 
            marginTop: '12px', 
            fontSize: '12px', 
            color: '#666',
            fontStyle: 'italic',
            textAlign: 'left'
          }}>
            Email links will open a pre-written email in a new tab. If they don't work: you can save the image and the text above (or write your own complaint) and send it to: <strong>enforcement@caa.co.za</strong> (SACAA) • <strong>TableM@sanparks.org</strong> (SanParks)
          </div>
        </div>

        {/* Close Button */}
        <div style={{ textAlign: 'center', paddingTop: '16px', borderTop: '1px solid #eee' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 24px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function FAQ() {
  const [open, setOpen] = useState(null);
  const faqs = [
    {
      question: 'Why does this page exist?',
      answer: (
        <div>
          <p>This page was created to help protect the natural tranquillity of Table Mountain National Park (TMNP). Helicopter flights can disturb wildlife, hikers, and the serenity of this unique environment.</p>
          <p>Our goal is to:</p>
          <ul>
            <li>Monitor and highlight helicopter activity over the park, especially those entering airspace where they shouldn't be.</li>
            <li>Inform the public about the extent of unauthorised or disruptive flights.</li>
            <li>Encourage accountability and compliance with airspace regulations.</li>
          </ul>
          <p>In short: This isn't about naming and shaming pilots or operators – it's about preserving the peace of our park for everyone who loves it, from hikers to wildlife.</p>
        </div>
      )
    },
    {
      question: 'What does the law say?',
      answer: (
        <div>
          <p>The law is very clear. Aircraft need permission to fly over Table Mountain National Park (TMNP). If they fly there without permission, there are severe penalties.</p>
          <p>See the National Environmental Management: Protected Areas Act (NEMPAA NP17), which clearly state that aircraft are prohibited from flying over TMNP at any height below 6070FT (~1850m).</p>
          <ul>
            <li><a href="/NEMPAA.pdf" target="_blank" rel="noopener noreferrer" download>NEMPAA (PDF)</a></li>
            <li><a href="/NP17.pdf" target="_blank" rel="noopener noreferrer" download>TMNP boundary NP17 (PDF)</a></li>
          </ul>
        </div>
      )
    },
    {
      question: 'What are the penalties?',
      answer: (
        <div>
          <p>The NEMPA act states the following penalties:</p>
          <p><b>89. Offences and penalties</b></p>
          <p>(1) A person is guilty of an offence if that person –<br/>
          (a) contravenes or fails to comply with a provision of section 45(1), 46(1), 47(2), (3) or (3A), 48(1), 49A(5)(b), 50(5) or 55(2)(fA);<br/>
          (b) contravenes a notice issued under section 51;<br/>
          (c) hinders or interferes with a management authority or a member or staff member of a management authority in the performance of official duties; or<br/>
          (d) falsely professes to be a member or staff member of a management authority, or the interpreter or assistant of such an officer.</p>
          <p><b>(2)</b> <b>A person convicted of an offence in terms of subsection (1) is liable, in the case of a first conviction, to a fine not exceeding R5 million or imprisonment for a period not exceeding five years and, in the case of a second or subsequent conviction, to a fine not exceeding R10 million or imprisonment for a period not exceeding ten years or in both instances to both a fine and such imprisonment.</b></p>
          <p>(3) Contravention of or failure to comply with any provision of a regulation made under section 86 or 87 is an offence.</p>
        </div>
      )
    },
    {
      question: 'Are there exceptions?',
      answer: (
        <div>
          <p>Aircraft participating in official duties, such as emergency services, firefighting, fire-spotting, crime patrolling, military and state aircraft, are assumed to have permission to enter airspace.</p>
          <p>Commercial and private aircraft (such as those doing film shoots or those collecting footage for races such as the Cape Argus or the Two Oceans Marathon), may request and be provided clearance to fly enter TM17.</p>
          <p>Tourist helicopters are assumed not to have permission to enter TM17 airspace and will be assumed subject to the penalties outlined above.</p>
        </div>
      )
    },
    {
      question: 'Why should I care about this?',
      answer: (
        <div>
          <p>The purpose of this exercise is not trivial nor is it retributive. NEMPAA exists for many valid reasons. There are very good reasons to care about this and to report offenders, including:</p>
          <p style={{ fontWeight: 'bold', marginTop: 24 }}>Environmental protection</p>
          <p>TMNP is a protected area and noisy, low-flying powered aircraft disturb:</p>
          <ul>
            <li>Wildlife (especially nesting birds, but also other mammals)</li>
            <li>Visitors to the natural World Heritage Site</li>
          </ul>
          <p style={{ fontWeight: 'bold', marginTop: 24 }}>Public Safety</p>
          <p>Unauthorised low-altitude flights pose a risk to hikers, paragliders, and other aircraft undertaking official duties (like firefighting, fire spotting, crime patrolling, and emergency medical services). Recording violations may help authorities respond to reckless or unsafe operations by unscrupulous operators who tarnish the name of law-abiding aviation companies and individuals.</p>
          <p style={{ fontWeight: 'bold', marginTop: 24 }}>Legal and Regulatory Accountability</p>
          <p>ATC and the South African Civil Aviation Authority (SACAA) rely on reports to investigate non-compliance. Records can contribute to:</p>
          <ul>
            <li>Noise complaints</li>
            <li>Unauthorised landings or low-level overflights</li>
            <li>Failing to adhere to prescribed air routes (e.g. above 2,500 ft MSL in NP17)</li>
          </ul>
          <p style={{ fontWeight: 'bold', marginTop: 24 }}>Contribute to Policy Enforcement</p>
          <p>SANParks and environmental bodies often lack resources or monitoring tools. Citizen reporting helps bridge the gap and push for stricter oversight and enforcement (the same way that they rely on the public to report other incidents and crimes, such as theft, vandalism, littering, arson, and injuries)</p>
          <p style={{ fontWeight: 'bold', marginTop: 24 }}>Transparency and Public Awareness</p>
          <p>Compiling and sharing data (ethically) can also:</p>
          <ul>
            <li>Raise community awareness (many aren't aware that their park is protected in this way)</li>
            <li>Support journalism, activism, or policy campaigns</li>
            <li>Show patterns of repeated violations (e.g. tourism operators flying low for views)</li>
          </ul>
        </div>
      )
    }
  ];
  return (
    <div style={{ maxWidth: 700, margin: '60px auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', padding: 32 }}>
      <h1 style={{ textAlign: 'center' }}>FAQ</h1>
      <div>
        {faqs.map((faq, idx) => (
          <div key={idx} style={{ marginBottom: 18, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
            <button
              onClick={() => setOpen(open === idx ? null : idx)}
              style={{
                background: 'none',
                border: 'none',
                color: '#007bff',
                fontWeight: 600,
                fontSize: 18,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                padding: '8px 0',
                outline: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <span>{open === idx ? '▼' : '▶'}</span> {faq.question}
            </button>
            {open === idx && <div style={{ marginTop: 8, color: '#333', fontSize: 16, textAlign: 'left' }}>{faq.answer}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [helicopters, setHelicopters] = useState([])
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const kmlLayerRef = useRef(null)
  const tmnpLayerRef = useRef(null)
  const [flightTrack, setFlightTrack] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [uploadedKmls, setUploadedKmls] = useState([])
  const flightTrackLayerRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [fetchError, setFetchError] = useState('')
  const fileInputRef = useRef()
  const [kmlInfos, setKmlInfos] = useState({})
  const [kmlSizes, setKmlSizes] = useState({})
  const placemarkMarkersRef = useRef([])
  const [showFAQ, setShowFAQ] = useState(false)
  const [kmlMetadata, setKmlMetadata] = useState([])
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [registrationFilter, setRegistrationFilter] = useState('')
  const [registrationInput, setRegistrationInput] = useState('')
  const [showRegDropdown, setShowRegDropdown] = useState(false)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [lastViewedFilename, setLastViewedFilename] = useState('');
  const [infoPopup, setInfoPopup] = useState({ open: false, idx: null });
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [reportModal, setReportModal] = useState({ isOpen: false, flightData: null });

  // Filter summary
  let filterSummary = 'All flights';
  if (registrationFilter || dateStart || dateEnd) {
    const parts = [];
    if (registrationFilter) parts.push(`Registration: ${registrationFilter}`);
    if (dateStart) parts.push(`From: ${dateStart}`);
    if (dateEnd) parts.push(`To: ${dateEnd}`);
    filterSummary = parts.join(', ');
  }

  // Fetch KML metadata from backend
  const fetchKmlMetadata = async () => {
    setLoadingMetadata(true);
    setFetchError('');
    try {
      const res = await fetch(`${BACKEND_URL}/kml-metadata`);
      if (!res.ok) throw new Error('Failed to fetch KML metadata');
      const data = await res.json();
      setKmlMetadata(data);
      console.log('DEBUG: kmlMetadata from backend', data);
    } catch (err) {
      setFetchError('Could not fetch KML metadata. Is the backend running?');
      setKmlMetadata([]);
    }
    setLoadingMetadata(false);
  };

  // Fetch uploaded KMLs for download links and file size
  const fetchKmls = async () => {
    setFetchError('');
    try {
      const res = await fetch(`${BACKEND_URL}/uploads`)
      if (!res.ok) throw new Error('Failed to fetch uploads')
      const data = await res.json()
      setUploadedKmls(data)
    } catch (err) {
      setFetchError('Could not fetch uploaded files. Is the backend running?')
      setUploadedKmls([])
    }
  }

  useEffect(() => {
    fetchKmlMetadata();
    fetchKmls();
  }, []);

  // Admin: Rescan KML Metadata
  const handleRescanMetadata = async () => {
    setLoadingMetadata(true);
    setFetchError('');
    try {
      const res = await fetch(`${BACKEND_URL}/refresh-metadata?admin=1`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh metadata');
      await fetchKmlMetadata();
    } catch (err) {
      setFetchError('Failed to refresh KML metadata');
    }
    setLoadingMetadata(false);
  };

  useEffect(() => {
    if (showFAQ) {
      // Remove the map if FAQ is open
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }
    if (!mapRef.current) {
      mapRef.current = L.map('map').setView([CAPE_TOWN_LAT, CAPE_TOWN_LON], 10)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(mapRef.current)

      // Add the TMNP boundary as a persistent layer
      tmnpLayerRef.current = omnivore.kml('/tmnp.kml')
        .on('ready', function() {
          this.setStyle(() => ({
            color: '#ff0000',
            weight: 3,
            opacity: 0.7,
            fillColor: '#ff0000',
            fillOpacity: 0.25
          }));
          mapRef.current.fitBounds(this.getBounds(), { padding: [20, 20] });
        })
        .addTo(mapRef.current)
    }
  }, [showFAQ])

  // Draw or remove flight track polyline
  useEffect(() => {
    if (!mapRef.current) return
    if (flightTrackLayerRef.current) {
      mapRef.current.removeLayer(flightTrackLayerRef.current)
      flightTrackLayerRef.current = null
    }
    if (flightTrack && flightTrack.length > 1) {
      flightTrackLayerRef.current = L.polyline(flightTrack, {
        color: '#0000ff',
        weight: 4,
        opacity: 0.8,
      }).addTo(mapRef.current)
      mapRef.current.fitBounds(flightTrackLayerRef.current.getBounds(), { padding: [20, 20] })
    }
  }, [flightTrack])

  // Check admin session on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/kml-metadata`, { credentials: 'include' })
      .then(() => {
        // Try to fetch an admin-only endpoint to check session
        fetch(`${BACKEND_URL}/refresh-metadata`, { method: 'POST', credentials: 'include' })
          .then(res => {
            if (res.ok) setIsAdmin(true)
            else setIsAdmin(false)
          })
          .catch(() => setIsAdmin(false))
      })
  }, [])

  // Placeholder for future backend/static bucket integration
  useEffect(() => {
    // TODO: Replace this with fetch from backend or static bucket
    setHelicopters([]) // Currently empty, ready for integration
  }, [])

  useEffect(() => {
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = []
    if (mapRef.current && helicopters.length > 0) {
      helicopters.forEach(heli => {
        if (heli.lat && heli.lon) {
          const marker = L.marker([heli.lat, heli.lon]).addTo(mapRef.current)
          marker.bindPopup(`Registration: ${heli.reg || 'N/A'}<br>Type: ${heli.t || 'N/A'}<br>Altitude: ${heli.alt_baro || 'N/A'} ft<br>Speed: ${heli.gs || 'N/A'} kts`)
          markersRef.current.push(marker)
        }
      })
    }
  }, [helicopters])

  // Handle KML upload
  const handleKmlUpload = async (e) => {
    setUploadMsg('')
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    let success = 0
    let fail = 0
    for (const file of files) {
      const formData = new FormData()
      formData.append('kml', file)
      try {
        const res = await fetch(`${BACKEND_URL}/upload`, {
          method: 'POST',
          body: formData
        })
        if (res.ok) {
          success++
        } else {
          fail++
        }
      } catch {
        fail++
      }
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (success && !fail) setUploadMsg(`Uploaded ${success} file(s) successfully!`)
    else if (success && fail) setUploadMsg(`Uploaded ${success} file(s), but ${fail} failed.`)
    else setUploadMsg('Upload failed. Please try again.')
    fetchKmls()
  }

  // Get unique registrations for filter dropdown
  const uniqueRegistrations = Array.from(new Set(kmlMetadata.map(m => m.registration).filter(r => r && r !== '-'))).sort();
  const filteredRegOptions = registrationInput
    ? uniqueRegistrations.filter(reg => reg.toLowerCase().includes(registrationInput.toLowerCase()))
    : uniqueRegistrations;

  // Filtered metadata
  const filteredMetadata = kmlMetadata.filter(meta => {
    // Registration filter
    if (registrationFilter && meta.registration !== registrationFilter) return false;
    // Date filter
    if (dateStart && (!meta.date || meta.date < dateStart)) return false;
    if (dateEnd && (!meta.date || meta.date > dateEnd)) return false;
    return true;
  });

  // Summary stats for filteredMetadata
  const flightCount = filteredMetadata.length;
  const uniqueHelis = Array.from(new Set(filteredMetadata.map(m => m.registration).filter(r => r && r !== '-'))).length;
  const dates = filteredMetadata.map(m => m.date).filter(Boolean).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'N/A';

  // CSV export function
  function exportCSV() {
    const headers = ['Date', 'UTC Time', 'SA Time', 'Registration', 'Filename', 'KML URL', 'Size (MB)'];
    const rows = filteredMetadata.map(meta => {
      const kml = uploadedKmls.find(k => k.filename === meta.filename) || {};
      return [
        meta.date || '',
        meta.time || '',
        utcToSaTime(meta.date, meta.time),
        meta.registration || '',
        meta.filename || '',
        kml.url ? `${BACKEND_URL}${kml.url}` : '',
        kmlSizes[meta.filename] || ''
      ];
    });
    const csvContent = [headers, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flights.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-container">
      {/* Top Menu Bar */}
      <div style={{ 
        position: 'fixed', 
        top: 0, // Remove conditional padding
        left: 0, 
        right: 0, 
        background: 'rgba(255, 255, 255, 0.95)', 
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
        padding: '16px 32px',
        zIndex: 1000, 
        display: 'flex', 
        justifyContent: 'flex-end', 
        gap: 16, 
        alignItems: 'center' 
      }}>
        <button
          style={{ background: 'none', border: 'none', color: '#007bff', fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: '8px 12px' }}
          onClick={() => setShowFAQ(false)}
        >
          Home
        </button>
        <button
          style={{ background: 'none', border: 'none', color: '#007bff', fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: '8px 12px' }}
          onClick={() => setShowFAQ(true)}
        >
          FAQ
        </button>
      </div>
      {/* FAQ Page */}
      {showFAQ ? (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: '70px' }}>
          <FAQ />
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button onClick={() => setShowFAQ(false)} style={{ padding: '8px 24px', borderRadius: 6, background: '#007bff', color: '#fff', border: 'none', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="main-content" style={{ paddingTop: '70px' }}>
          <h1 className="main-title" style={{ marginTop: 24, marginBottom: 16 }}>Misbehaving Operators Roaming Over National Sanctuaries</h1>
          
          {/* Selected Flight Section (above map for better visibility) */}
          <SelectedFlightSection 
            flight={selectedFlight} 
            onClose={() => setSelectedFlight(null)} 
            fileSize={selectedFlight ? selectedFlight.fileSizeMB : null}
            onJumpToTable={() => {
              // Scroll to the specific flight row
              const rowElement = document.getElementById(`flight-${selectedFlight.filename}`);
              if (rowElement) {
                rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash effect to highlight the row
                rowElement.style.transition = 'background-color 0.5s';
                rowElement.style.backgroundColor = '#fff7e6';
                setTimeout(() => {
                  rowElement.style.backgroundColor = '#e6f7ff';
                }, 1000);
              }
            }}
            onReport={(flight) => {
              // Open report modal with flight data
              setReportModal({ 
                isOpen: true, 
                flightData: flight 
              });
            }}
          />
          
          <div id="map" style={{ height: '600px', width: '100%', marginTop: 0, marginBottom: 24 }}></div>
          
          <div style={{marginTop: 24, textAlign: 'left'}}>
            {helicopters.length > 0 && (
              <div>
                <h2>Helicopters over Table Mountain National Park</h2>
                <ul>
                  {helicopters.filter(heli => heli.lat && heli.lon && isInTableMountainArea(heli.lat, heli.lon)).map(heli => (
                    <li key={heli.reg || heli.hex}>
                      <strong>{heli.reg || heli.hex}</strong> — Type: {heli.t || 'N/A'}, Altitude: {heli.alt_baro || 'N/A'} ft, Speed: {heli.gs || 'N/A'} kts
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {/* Violations Table */}
          <div id="violations-table">
            {/* Summary Section */}
            <div style={{ margin: '0 0 18px 0', fontSize: 18, color: '#223', fontWeight: 500, textAlign: 'center' }}>
              Summary: <strong>{flightCount} flight{flightCount === 1 ? '' : 's'} shown</strong> with <i>likely</i> <strong>NP17</strong> airspace violations over Table Mountain National Park, from <strong>{uniqueHelis} helicopter{uniqueHelis === 1 ? '' : 's'}</strong>, with flight logs shown from <strong>{dates.length > 0 ? dates[0] : ''}</strong> <span style={{ fontWeight: 500 }}>to</span> <strong>{dates.length > 0 ? dates[dates.length - 1] : ''}</strong>
            </div>
            {/* Filters */}
            <div style={{ width: '100%', margin: '0 auto 24px auto', maxWidth: 800 }}>
              <div style={{ background: '#f7f9fa', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', padding: showFilters ? 24 : 16, marginBottom: 8, border: '1px solid #e3e8ee', transition: 'padding 0.2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showFilters ? 18 : 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 18, color: '#223', letterSpacing: 0.2 }}>Tools and filters 🔧</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: '#555', fontSize: 15 }}>{filterSummary}</span>
                    <button onClick={() => setShowFilters(f => !f)} style={{ padding: '6px 18px', borderRadius: 6, background: '#007bff', color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                      {showFilters ? 'Hide Filters' : 'Show Filters'}
                    </button>
                    {(registrationFilter || dateStart || dateEnd) && (
                      <button onClick={() => { setRegistrationFilter(''); setRegistrationInput(''); setDateStart(''); setDateEnd(''); }} style={{ padding: '6px 12px', borderRadius: 6, background: '#eee', color: '#222', border: 'none', fontWeight: 500, fontSize: 14, cursor: 'pointer' }}>Clear Filters</button>
                    )}
                  </div>
                </div>
                {showFilters && (
                  <div style={{ display: 'flex', gap: 24, marginTop: 8, alignItems: 'center', justifyContent: 'flex-start' }}>
                    {/* Registration Filter */}
                    <div style={{ position: 'relative', minWidth: 180 }}>
                      <label style={{ fontWeight: 600 }}>Registration:</label><br />
                      <input
                        type="text"
                        placeholder="Type registration..."
                        value={registrationInput}
                        onChange={e => {
                          setRegistrationInput(e.target.value);
                          setShowRegDropdown(true);
                        }}
                        onFocus={() => setShowRegDropdown(true)}
                        style={{ minWidth: 160 }}
                      />
                      {registrationFilter && (
                        <button onClick={() => { setRegistrationFilter(''); setRegistrationInput(''); }} style={{ marginLeft: 8, fontSize: 14 }}>Clear</button>
                      )}
                      {showRegDropdown && filteredRegOptions.length > 0 && registrationInput && (
                        <div style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #ccc', borderRadius: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.07)', maxHeight: 120, overflowY: 'auto', width: '100%' }}>
                          {filteredRegOptions.map(reg => (
                            <div
                              key={reg}
                              onMouseDown={() => {
                                setRegistrationFilter(reg);
                                setRegistrationInput(reg);
                                setShowRegDropdown(false);
                              }}
                              style={{ padding: '6px 12px', cursor: 'pointer', background: reg === registrationFilter ? '#e6f0ff' : '#fff' }}
                            >
                              {reg}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Date Filter */}
                    <div>
                      <label style={{ fontWeight: 600 }}>Date from:</label><br />
                      <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontWeight: 600 }}>Date to:</label><br />
                      <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
                    </div>
                    {/* Export CSV Button */}
                    <div>
                      <button onClick={exportCSV} style={{ padding: '8px 24px', borderRadius: 6, background: '#28a745', color: '#fff', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                        Export CSV
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <h2>Airspace Violations</h2>
            {fetchError && <div style={{ color: 'red', marginBottom: 12 }}>{fetchError}</div>}
            {loadingMetadata && <div style={{ color: '#007bff', marginBottom: 12 }}>Loading metadata...</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Date</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>UTC Time</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>SA Time</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Registration</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Filename</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>KML</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Size</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>View Flight</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Take action</th>
                </tr>
              </thead>
              <tbody>
                {filteredMetadata.length === 0 && !fetchError && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: '#888' }}>No files found.</td></tr>
                )}
                {filteredMetadata
                  .slice()
                  .sort((a, b) => {
                    const dtA = a.date && a.time ? new Date(`${a.date}T${a.time}:00Z`).getTime() : 0;
                    const dtB = b.date && b.time ? new Date(`${b.date}T${b.time}:00Z`).getTime() : 0;
                    return dtB - dtA;
                  })
                  .map((meta, idx) => {
                    const kml = uploadedKmls.find(k => k.filename === meta.filename) || {};
                    return (
                      <tr 
                        key={idx} 
                        id={`flight-${meta.filename}`}
                        style={lastViewedFilename === meta.filename ? { background: '#e6f7ff' } : {}}
                      >
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{meta.date || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{meta.time || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{utcToSaTime(meta.date, meta.time)}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{meta.registration || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{meta.filename || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd', textAlign: 'center' }}>
                          {kml.url ? (
                            <a href={`${BACKEND_URL}${kml.url}`} download={meta.filename} title="Download KML" style={{ fontSize: '1.3em', color: '#007bff', textDecoration: 'none', cursor: 'pointer' }}>
                              ⬇️
                            </a>
                          ) : '-'}
                        </td>
                        <td style={{ padding: 8, border: '1px solid #ddd', textAlign: 'center' }}>
                          {meta.fileSizeMB ? `${meta.fileSizeMB} MB` : '-'}
                        </td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>
                          {kml.url ? (
                            <button onClick={async () => {
                              // Set selected flight with KML data for SelectedFlightSection
                              setSelectedFlight({
                                ...meta,
                                kmlData: kml
                              });
                              
                              // Scroll to top to show the map update
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                              setLastViewedFilename(meta.filename);
                              // Remove previous KML layer and markers
                              if (kmlLayerRef.current) {
                                mapRef.current.removeLayer(kmlLayerRef.current)
                                kmlLayerRef.current = null
                              }
                              placemarkMarkersRef.current.forEach(m => mapRef.current.removeLayer(m))
                              placemarkMarkersRef.current = []
                              // Add new KML layer
                              kmlLayerRef.current = omnivore.kml(`${BACKEND_URL}${kml.url}`)
                                .on('ready', function() {
                                  this.setStyle(() => ({
                                    color: '#0000ff',
                                    weight: 4,
                                    opacity: 0.8
                                  }));
                                  // Fit bounds to both TMNP and the new KML if both are present
                                  if (tmnpLayerRef.current) {
                                    const group = L.featureGroup([tmnpLayerRef.current, this]);
                                    mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
                                  } else {
                                    mapRef.current.fitBounds(this.getBounds(), { padding: [20, 20] });
                                  }
                                })
                                .addTo(mapRef.current)
                              // Fetch and parse KML for placemarks (optional, for popups)
                              try {
                                const res = await fetch(`${BACKEND_URL}${kml.url}`)
                                const text = await res.text()
                                const parser = new window.DOMParser()
                                const xml = parser.parseFromString(text, 'text/xml')
                                const placemarks = Array.from(xml.querySelectorAll('Folder > Placemark'))
                                placemarks.forEach(pm => {
                                  const name = pm.querySelector('name')?.textContent || ''
                                  const desc = pm.querySelector('description')?.textContent || ''
                                  const when = pm.querySelector('TimeStamp > when')?.textContent || ''
                                  const coords = pm.querySelector('Point > coordinates')?.textContent || ''
                                  // Parse coordinates (lon,lat,alt)
                                  const [lon, lat] = coords.split(',').map(Number)
                                  // Extract Altitude, Speed, Heading from desc (HTML)
                                  let altitude = '', speed = '', heading = ''
                                  const altMatch = desc.match(/Altitude:\s*([\d,]+) ft/i)
                                  if (altMatch) altitude = altMatch[1]
                                  const spdMatch = desc.match(/Speed:\s*([\d,]+) kt/i)
                                  if (spdMatch) speed = spdMatch[1]
                                  const hdgMatch = desc.match(/Heading:\s*([\d,]+)[^\d]?/i)
                                  if (hdgMatch) heading = hdgMatch[1]
                                  // Compose popup HTML
                                  const popup = `<div style='font-size:14px;'><b>${name}</b><br/>`
                                    + (altitude ? `<b>Altitude:</b> ${altitude} ft<br/>` : '')
                                    + (speed ? `<b>Speed:</b> ${speed} kt<br/>` : '')
                                    + (heading ? `<b>Heading:</b> ${heading}&deg;<br/>` : '')
                                    + `</div>`
                                  if (!isNaN(lat) && !isNaN(lon)) {
                                    const marker = L.marker([lat, lon]).addTo(mapRef.current)
                                    marker.bindPopup(popup)
                                    placemarkMarkersRef.current.push(marker)
                                  }
                                })
                              } catch {}
                            }} style={{ padding: '4px 12px', borderRadius: 4, background: '#007bff', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '1.2em' }} title="View on map">
                              👀
                            </button>
                          ) : '-'}
                        </td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>
                          <button 
                            onClick={() => {
                              // Open report modal with flight data
                              setReportModal({ 
                                isOpen: true, 
                                flightData: meta 
                              });
                            }} 
                            style={{ 
                              padding: '6px 12px', 
                              borderRadius: 4, 
                              background: '#dc3545', 
                              color: '#fff', 
                              border: 'none', 
                              cursor: 'pointer', 
                              fontSize: '18px',
                              fontWeight: '600',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }} 
                            title="Generate violation report"
                          >
                            👮‍♂️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {/* Admin Interface */}
          {isAdmin && (
            <div style={{ margin: '40px auto', padding: 24, background: '#f9f9f9', borderRadius: 8, maxWidth: 500, boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
              <button onClick={handleRescanMetadata} style={{ marginBottom: 18, padding: '8px 24px', borderRadius: 6, background: '#007bff', color: '#fff', border: 'none', fontWeight: 600, fontSize: 16, cursor: 'pointer' }} disabled={loadingMetadata}>
                {loadingMetadata ? 'Rescanning...' : 'Rescan KML Metadata'}
              </button>
              <h2 style={{ textAlign: 'center', marginBottom: 24 }}>Admin: Upload KML Files</h2>
              <input
                ref={fileInputRef}
                type="file"
                accept=".kml"
                multiple
                onChange={handleKmlUpload}
                style={{ display: 'block', margin: '0 auto 20px auto' }}
                disabled={uploading}
              />
              {uploading && <div style={{ color: '#007bff', marginTop: 8 }}>Uploading...</div>}
              {uploadMsg && <div style={{ color: uploadMsg.includes('fail') ? 'orange' : uploadMsg.includes('success') ? 'green' : 'red', marginTop: 8 }}>{uploadMsg}</div>}
            </div>
          )}
        </div>
      )}
      
      {/* Report Modal */}
      <ReportModal 
        isOpen={reportModal.isOpen}
        onClose={() => setReportModal({ isOpen: false, flightData: null })}
        flightData={reportModal.flightData}
      />
    </div>
  )
}

export default App
