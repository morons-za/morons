import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import omnivore from 'leaflet-omnivore'

const CAPE_TOWN_LAT = -33.9249;
const CAPE_TOWN_LON = 18.4241;
const SEARCH_RADIUS_NM = 50; // nautical miles
const BACKEND_URL = 'http://localhost:4000';

function isInTableMountainArea(lat, lon) {
  // Rough bounding box for Table Mountain National Park
  return lat >= -34.1 && lat <= -33.9 && lon >= 18.3 && lon <= 18.5
}

function extractKmlInfo(kmlText) {
  try {
    const parser = new window.DOMParser();
    const xml = parser.parseFromString(kmlText, 'text/xml');
    // Registration: try <Document><name> or <description>
    let registration = '';
    const docName = xml.querySelector('Document > name');
    if (docName && docName.textContent) {
      // Try to extract reg from e.g. '-/ZSHIM' or similar
      const match = docName.textContent.match(/[A-Z0-9-]{4,}/i);
      if (match) registration = match[0];
    }
    if (!registration) {
      // Try <description> with <a> tag
      const desc = xml.querySelector('Document > description');
      if (desc) {
        const html = desc.textContent;
        const regMatch = html.match(/Registration<[^>]*>.*?<a [^>]*>([A-Z0-9-]+)<\/a>/i);
        if (regMatch) registration = regMatch[1];
      }
    }
    // Date/Time: first <Placemark> <name> or <TimeStamp> <when>
    let date = '';
    let time = '';
    const firstPlacemark = xml.querySelector('Folder > Placemark');
    if (firstPlacemark) {
      // Try <name> e.g. '2025-05-03 07:31:49 UTC'
      const placemarkName = firstPlacemark.querySelector('name');
      if (placemarkName && placemarkName.textContent) {
        const dtMatch = placemarkName.textContent.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
        if (dtMatch) {
          date = dtMatch[1];
          time = dtMatch[2];
        }
      }
      // Try <TimeStamp><when>
      if (!date || !time) {
        const when = firstPlacemark.querySelector('TimeStamp > when');
        if (when && when.textContent) {
          const dtMatch = when.textContent.match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
          if (dtMatch) {
            date = dtMatch[1];
            time = dtMatch[2];
          }
        }
      }
    }
    return { registration, date, time };
  } catch {
    return { registration: '', date: '', time: '' };
  }
}

function utcToSaTime(date, time) {
  if (!date || !time) return '-';
  // date: '2025-05-03', time: '07:31'
  const utc = new Date(`${date}T${time}:00Z`);
  // South Africa is UTC+2
  const sa = new Date(utc.getTime() + 2 * 60 * 60 * 1000);
  return sa.toISOString().slice(11, 16); // 'HH:MM'
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
          <p>Aircraft participating in official duties, such as emergency services, firefighting, fire-spotting, crime patrols, military and state aircraft, are assumed to have permission to enter airspace.</p>
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
          <p>TMNP is a protected area and noisy, low-flying powered aircraft <a href="#" style={{ color: 'red', textDecoration: 'underline' }}>disturb</a>:</p>
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
  const [adminModalOpen, setAdminModalOpen] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('isAdmin') === 'true')
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

  // Fetch uploaded KMLs from backend
  const fetchKmls = async () => {
    setFetchError('')
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
    fetchKmls()
  }, [])

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
          this.setStyle({
            color: '#ff0000',
            weight: 3,
            opacity: 0.7,
            fillOpacity: 0.1
          });
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

  // Persist admin login in localStorage
  useEffect(() => {
    localStorage.setItem('isAdmin', isAdmin ? 'true' : 'false')
  }, [isAdmin])

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

  // Admin login handler
  const handleAdminLogin = (e) => {
    e.preventDefault()
    if (adminEmail === 'test@test.com' && adminPassword === '123') {
      setIsAdmin(true)
      setAdminModalOpen(false)
      setAdminError('')
      setAdminEmail('')
      setAdminPassword('')
    } else {
      setAdminError('Invalid credentials')
    }
  }

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

  // Fetch and parse KML info for each uploaded file
  useEffect(() => {
    async function fetchAllKmlInfo() {
      const infos = {};
      const sizes = {};
      for (const kml of uploadedKmls) {
        try {
          // Fetch file size using HEAD request
          const headRes = await fetch(`${BACKEND_URL}${kml.url}`, { method: 'HEAD' })
          const size = headRes.headers.get('content-length')
          if (size) sizes[kml.filename] = (Number(size) / (1024 * 1024)).toFixed(2)
          // Fetch and parse KML info
          const res = await fetch(`${BACKEND_URL}${kml.url}`)
          const text = await res.text();
          infos[kml.filename] = extractKmlInfo(text);
        } catch {
          infos[kml.filename] = { registration: '', date: '', time: '' };
          sizes[kml.filename] = null;
        }
      }
      setKmlInfos(infos);
      setKmlSizes(sizes);
    }
    if (uploadedKmls.length > 0) fetchAllKmlInfo();
  }, [uploadedKmls]);

  return (
    <div className="app-container">
      {/* Top Menu Bar */}
      <div style={{ position: 'absolute', top: 24, right: 32, zIndex: 1000, display: 'flex', gap: 16, alignItems: 'center' }}>
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
        {!isAdmin && (
          <button onClick={() => setAdminModalOpen(true)} style={{ padding: '8px 18px', borderRadius: 6, background: '#222', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
            Admin Login
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setIsAdmin(false)} style={{ marginLeft: 12, padding: '8px 18px', borderRadius: 6, background: '#eee', color: '#222', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
            Logout
          </button>
        )}
      </div>
      {/* FAQ Page */}
      {showFAQ ? (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <FAQ />
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button onClick={() => setShowFAQ(false)} style={{ padding: '8px 24px', borderRadius: 6, background: '#007bff', color: '#fff', border: 'none', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="main-content">
          <h1 className="main-title">Misbehaving Operators Roaming Over National Sanctuaries</h1>
          <div id="map" style={{ height: '600px', width: '100%' }}></div>
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
          <div style={{ width: '100%', maxWidth: 800, margin: '32px auto 0 auto' }}>
            <h2>Airspace Violations</h2>
            {fetchError && <div style={{ color: 'red', marginBottom: 12 }}>{fetchError}</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Filename</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Size</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>KML</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Date</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>UTC Time</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>SA Time</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>Registration</th>
                  <th style={{ padding: 8, border: '1px solid #ddd' }}>View</th>
                </tr>
              </thead>
              <tbody>
                {uploadedKmls.length === 0 && !fetchError && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 16, color: '#888' }}>No files found.</td></tr>
                )}
                {uploadedKmls
                  .slice() // copy to avoid mutating state
                  .sort((a, b) => {
                    const infoA = kmlInfos[a.filename] || {};
                    const infoB = kmlInfos[b.filename] || {};
                    const dtA = infoA.date && infoA.time ? new Date(`${infoA.date}T${infoA.time}:00Z`).getTime() : 0;
                    const dtB = infoB.date && infoB.time ? new Date(`${infoB.date}T${infoB.time}:00Z`).getTime() : 0;
                    return dtB - dtA; // most recent first
                  })
                  .map((kml, idx) => {
                    const info = kmlInfos[kml.filename] || {};
                    return (
                      <tr key={idx}>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{kml.filename}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd', textAlign: 'center' }}>
                          {kmlSizes[kml.filename] ? `${kmlSizes[kml.filename]} MB` : '-'}
                        </td>
                        <td style={{ padding: 8, border: '1px solid #ddd', textAlign: 'center' }}>
                          <a href={`${BACKEND_URL}${kml.url}`} download={kml.filename} title="Download KML" style={{ fontSize: '1.3em', color: '#007bff', textDecoration: 'none', cursor: 'pointer' }}>
                            ⬇️
                          </a>
                        </td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{info.date || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{info.time || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{utcToSaTime(info.date, info.time)}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>{info.registration || '-'}</td>
                        <td style={{ padding: 8, border: '1px solid #ddd' }}>
                          <button onClick={async () => {
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
                                this.setStyle({
                                  color: '#0000ff',
                                  weight: 4,
                                  opacity: 0.8
                                });
                                // Fit bounds to both TMNP and the new KML if both are present
                                if (tmnpLayerRef.current) {
                                  const group = L.featureGroup([tmnpLayerRef.current, this]);
                                  mapRef.current.fitBounds(group.getBounds(), { padding: [20, 20] });
                                } else {
                                  mapRef.current.fitBounds(this.getBounds(), { padding: [20, 20] });
                                }
                              })
                              .addTo(mapRef.current)
                            // Fetch and parse KML for placemarks
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
    </div>
  )
}

export default App
