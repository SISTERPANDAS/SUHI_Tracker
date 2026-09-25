let mapRoiPicker;
let mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd;
let drawnItems = null;
let drawControl = null;
let currentRoiPolygon = null;
let currentMode = 'region';
let trendChartInstance = null;
let scatterChartInstance = null;

let builtStartLayers, builtEndLayers, lstStartLayers, lstEndLayers;

let activeLayers = {
    'built-start': [],
    'built-end': [],
    'lst-start': [],
    'lst-end': []
};

let isSidebarOpen = false;
let searchDebounceTimer = null;

// Curated Catalog of Major Indian Cities & Tier-1/2 Metros
const MAJOR_INDIAN_CITIES = {
    "Delhi NCR": [28.6139, 77.2090],
    "Mumbai": [19.0760, 72.8777],
    "Bengaluru": [12.9716, 77.5946],
    "Hyderabad": [17.3850, 78.4867],
    "Chennai": [13.0827, 80.2707],
    "Kolkata": [22.5726, 88.3639],
    "Ahmedabad": [23.0225, 72.5714],
    "Pune": [18.5204, 73.8567],
    "Jaipur": [26.9124, 75.7873],
    "Surat": [21.1702, 72.8311],
    "Lucknow": [26.8467, 80.9462],
    "Visakhapatnam": [17.6868, 83.2185],
    "Kanpur": [26.4499, 80.3319],
    "Nagpur": [21.1458, 79.0882],
    "Indore": [22.7196, 75.8577],
    "Thane": [19.2183, 72.9781],
    "Bhopal": [23.2599, 77.4126],
    "Patna": [25.5941, 85.1376],
    "Vadodara": [22.3072, 73.1812],
    "Ghaziabad": [28.6692, 77.4538],
    "Ludhiana": [30.9010, 75.8573],
    "Agra": [27.1767, 78.0081],
    "Nashik": [19.9975, 73.7898],
    "Faridabad": [28.4089, 77.3178],
    "Meerut": [28.9845, 77.7064],
    "Rajkot": [22.3039, 70.8022],
    "Varanasi": [25.3176, 82.9739],
    "Srinagar": [34.0837, 74.7973],
    "Aurangabad": [19.8762, 75.3433],
    "Dhanbad": [23.7957, 86.4304],
    "Amritsar": [31.6340, 74.8723],
    "Allahabad (Prayagraj)": [25.4358, 81.8463],
    "Ranchi": [23.3441, 85.3096],
    "Coimbatore": [11.0168, 76.9558],
    "Jabalpur": [23.1815, 79.9864],
    "Gwalior": [26.2183, 78.1828],
    "Vijayawada": [16.5062, 80.6480],
    "Jodhpur": [26.2389, 73.0243],
    "Madurai": [9.9252, 78.1198],
    "Raipur": [21.2514, 81.6296],
    "Kota": [25.2138, 75.8648],
    "Guwahati": [26.1445, 91.7362],
    "Chandigarh": [30.7333, 76.7794],
    "Solapur": [17.6599, 75.9064],
    "Hubli-Dharwad": [15.3647, 75.1240],
    "Bareilly": [28.3670, 79.4304],
    "Mysuru (Mysore)": [12.2958, 76.6394],
    "Tiruchirappalli": [10.7905, 78.7047],
    "Kochi": [9.9312, 76.2673],
    "Bhubaneswar": [20.2961, 85.8245],
    "Dehradun": [30.3165, 78.0322]
};

function createBoundingPolygonFromCoords(lat, lon, delta = 0.06) {
    const west = parseFloat((lon - delta).toFixed(4));
    const east = parseFloat((lon + delta).toFixed(4));
    const south = parseFloat((lat - delta).toFixed(4));
    const north = parseFloat((lat + delta).toFixed(4));

    return [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
    ];
}

function centerRoiPickerOnSelectedRegion() {
    const regionSelect = document.getElementById('select-region');
    if (!regionSelect) return;

    const cityName = regionSelect.value;
    const coords = MAJOR_INDIAN_CITIES[cityName];
    if (!coords) return;

    const [lat, lon] = coords;

    if (mapRoiPicker) {
        mapRoiPicker.setView([lat, lon], 11);
    }

    currentRoiPolygon = createBoundingPolygonFromCoords(lat, lon, 0.06);
    updateBufferedBoundsFromPolygon(currentRoiPolygon);
    checkAoiAreaWarning(currentRoiPolygon);

    if (drawnItems) {
        drawnItems.clearLayers();
        const delta = 0.06;
        const rectLayer = L.rectangle([[lat - delta, lon - delta], [lat + delta, lon + delta]], {
            color: '#0d9488',
            fillColor: '#14b8a6',
            fillOpacity: 0.25,
            weight: 2
        });
        drawnItems.addLayer(rectLayer);
    }
}

// Function to generate a bounding box around (longitude, latitude)
function updateRoiFromCoordinates() {
    const lonInput = document.getElementById('coord-x');
    const latInput = document.getElementById('coord-y');

    if (!lonInput || !latInput) return;

    const lon = parseFloat(lonInput.value);
    const lat = parseFloat(latInput.value);

    if (isNaN(lon) || isNaN(lat)) return;

    // Center map view on entered point
    if (mapRoiPicker) {
        mapRoiPicker.setView([lat, lon], 12);
    }

    // Generate ~10 km x 10 km bounding box around (lon, lat)
    const delta = 0.05; // ~5.5 km buffer
    const west = parseFloat((lon - delta).toFixed(4));
    const east = parseFloat((lon + delta).toFixed(4));
    const south = parseFloat((lat - delta).toFixed(4));
    const north = parseFloat((lat + delta).toFixed(4));

    // GeoJSON/GEE order: [Longitude, Latitude]
    currentRoiPolygon = [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south]
    ];

    updateBufferedBoundsFromPolygon(currentRoiPolygon);
    checkAoiAreaWarning(currentRoiPolygon);

    // Render bounding box on selector map
    if (drawnItems) {
        drawnItems.clearLayers();
        const rectLayer = L.rectangle([[south, west], [north, east]], {
            color: '#0d9488',
            fillColor: '#14b8a6',
            fillOpacity: 0.25,
            weight: 2
        });
        drawnItems.addLayer(rectLayer);
    }
}

// Fixed setRoiMode that properly generates geometry for coordinate mode
function setRoiMode(mode) {

    currentMode = mode;

    if (mode !== 'draw' && drawnItems) {

        drawnItems.clearLayers();

        currentRoiPolygon = null;

    }

    ['region', 'coordinates', 'draw'].forEach(m => {

        document.getElementById(`btn-mode-${m}`)?.classList.toggle('active-roi-tab', m === mode);

        document.getElementById(`panel-${m}`)?.classList.toggle('hidden', m !== mode);

    });

}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Icons and UI Components
    if (window.lucide) lucide.createIcons();
    initRoiPickerMap();
    initOutputMaps();
    initAnalyticsCharts();
    initCitySearchBar();

    // 2. Enforce Default Time-Series Chart View & Wire Tab Listeners
    if (typeof switchChartTab === 'function') {
        switchChartTab('trend');
    }
    document.getElementById('select-region')?.addEventListener('change', centerRoiPickerOnSelectedRegion);
    document.getElementById('coord-x')?.addEventListener('input', updateRoiFromCoordinates);
    document.getElementById('coord-y')?.addEventListener('input', updateRoiFromCoordinates);
    centerRoiPickerOnSelectedRegion();
    document.getElementById('tab-trend')?.addEventListener('click', () => switchChartTab('trend'));
    document.getElementById('tab-scatter')?.addEventListener('click', () => switchChartTab('scatter'));

    // 3. Open Sidebar if handler exists
    if (typeof openSidebar === 'function') {
        openSidebar();
    }

    // 4. Region Dropdown Change Listener
    document.getElementById('select-region')?.addEventListener('change', () => {
        if (typeof centerRoiPickerOnSelectedRegion === 'function') {
            centerRoiPickerOnSelectedRegion();
        }
    });

    // 5. Global Click Handler for Outside Clicks (Sidebar & Autocomplete Dismissal)
    document.addEventListener('click', (e) => {
        // Dismiss Sidebar on outside click (mobile/overlay mode)
        const sidebar = document.getElementById('main-sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle-btn');
        const sidebarOpen = (typeof isSidebarOpen !== 'undefined') ? isSidebarOpen : false;

        if (sidebarOpen && sidebar && !sidebar.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
            if (typeof closeSidebar === 'function') {
                closeSidebar();
            }
        }

        // Dismiss City Search Suggestions Dropdown on outside click
        const searchInput = document.getElementById('city-search-input');
        const suggestionsBox = document.getElementById('search-suggestions');

        if (suggestionsBox && !suggestionsBox.contains(e.target) && e.target !== searchInput) {
            suggestionsBox.classList.add('hidden');
        }
    });
});

function toggleSidebar(e) {
    if (e) e.stopPropagation();
    isSidebarOpen ? closeSidebar() : openSidebar();
}

function openSidebar() {
    isSidebarOpen = true;
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebar?.classList.remove('-translate-x-full');
    backdrop?.classList.remove('opacity-0', 'pointer-events-none');
    backdrop?.classList.add('opacity-100');
}

function closeSidebar() {
    isSidebarOpen = false;
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebar?.classList.add('-translate-x-full');
    backdrop?.classList.remove('opacity-100');
    backdrop?.classList.add('opacity-0', 'pointer-events-none');
}

// 1. Initial Map Viewport Set to Countrywide India
function initRoiPickerMap() {
    const indiaCenterCoords = [20.5937, 78.9629];
    const baseTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileOptions = { 
        maxZoom: 19, 
        attribution: '&copy; OpenStreetMap contributors' 
    };

    mapRoiPicker = L.map('map-roi-picker', { zoomControl: true }).setView(indiaCenterCoords, 5);
    L.tileLayer(baseTileUrl, tileOptions).addTo(mapRoiPicker);

    drawnItems = new L.FeatureGroup().addTo(mapRoiPicker);

    drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: { color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.3 }
            },
            rectangle: {
                shapeOptions: { color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.3 }
            },
            circle: false, marker: false, polyline: false, circlemarker: false
        },
        edit: { featureGroup: drawnItems, remove: true }
    });

    mapRoiPicker.addControl(drawControl);

    mapRoiPicker.on(L.Draw.Event.CREATED, function (event) {
        drawnItems.clearLayers();
        const layer = event.layer;
        drawnItems.addLayer(layer);

        const geojson = layer.toGeoJSON();
        if (geojson && geojson.geometry && geojson.geometry.coordinates) {
            let coords = geojson.geometry.coordinates;
            while (Array.isArray(coords) && coords.length > 0 && Array.isArray(coords[0][0])) {
                coords = coords[0];
            }
            currentRoiPolygon = coords.map(pt => [parseFloat(pt[0]), parseFloat(pt[1])]);

            if (currentRoiPolygon.length > 0 &&
                (currentRoiPolygon[0][0] !== currentRoiPolygon[currentRoiPolygon.length - 1][0] ||
                 currentRoiPolygon[0][1] !== currentRoiPolygon[currentRoiPolygon.length - 1][1])) {
                currentRoiPolygon.push([...currentRoiPolygon[0]]);
            }
            updateBufferedBoundsFromPolygon(currentRoiPolygon);

            // Evaluate if drawn polygon exceeds 10 x 10 km² (100 km²)
            if (typeof checkAoiAreaWarning === 'function') {
                checkAoiAreaWarning(currentRoiPolygon);
            }

            setRoiMode('draw');
            openSidebar();
        }
    });

    mapRoiPicker.on(L.Draw.Event.DELETED, function () {
        currentRoiPolygon = null;
        // Hide large AOI warning when drawn layers are cleared
        if (typeof checkAoiAreaWarning === 'function') {
            checkAoiAreaWarning(null);
        }
    });

    setTimeout(() => mapRoiPicker.invalidateSize(), 250);
}

// 2. Ranked City Search Implementation
function initCitySearchBar() {
    const searchInput = document.getElementById('city-search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const suggestionsBox = document.getElementById('search-suggestions');

    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchDebounceTimer);

        if (query.length > 0) {
            clearBtn?.classList.remove('hidden');
        } else {
            clearBtn?.classList.add('hidden');
            suggestionsBox?.classList.add('hidden');
            return;
        }

        if (query.length < 2) return;

        // 1. Prioritize matches from Curated Major Cities Catalog
        const qLower = query.toLowerCase();
        const localMatches = Object.keys(MAJOR_INDIAN_CITIES)
            .filter(cityName => cityName.toLowerCase().includes(qLower))
            .sort((a, b) => {
                const aStarts = a.toLowerCase().startsWith(qLower);
                const bStarts = b.toLowerCase().startsWith(qLower);
                if (aStarts && !bStarts) return -1;
                if (!aStarts && bStarts) return 1;
                return a.localeCompare(b);
            })
            .map(cityName => ({
                lat: MAJOR_INDIAN_CITIES[cityName][0],
                lon: MAJOR_INDIAN_CITIES[cityName][1],
                cleanName: cityName,
                regionType: 'Major City',
                rank: 1
            }));

        if (localMatches.length > 0) {
            renderFormattedSuggestions(localMatches);
        }

        // 2. Fetch wider administrative entities from Nominatim
        searchDebounceTimer = setTimeout(async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=in&q=${encodeURIComponent(query)}&limit=40`;
                const res = await fetch(url);
                const results = await res.json();
                processAndRenderResults(results, localMatches, query);
            } catch (err) {
                console.error("Geocoding fetch error:", err);
            }
        }, 250);
    });
}

function processAndRenderResults(results, localMatches = [], query = '') {
    const suggestionsBox = document.getElementById('search-suggestions');
    if (!suggestionsBox) return;

    const seenNames = new Set(localMatches.map(m => m.cleanName.toLowerCase()));
    const apiMatches = [];
    const qLower = query.toLowerCase();

    if (results && results.length > 0) {
        results.forEach(item => {
            const addr = item.address || {};
            const placeClass = item.class || '';
            const placeType = item.type || '';

            // Exclude non-settlement POIs, buildings, and streets
            const isInvalid = ['building', 'amenity', 'shop', 'highway', 'tourism', 'leisure', 'apartments', 'residential'].includes(placeClass) ||
                              ['hotel', 'apartments', 'house', 'commercial', 'guest_house', 'parking'].includes(placeType);

            if (isInvalid) return;

            const cityName = addr.city || addr.town || addr.municipality || addr.state_district || addr.district || item.name;
            const stateName = addr.state || '';
            if (!cityName) return;

            const cleanDisplayName = stateName ? `${cityName}, ${stateName}` : cityName;
            if (seenNames.has(cleanDisplayName.toLowerCase())) return;

            // Assign hierarchy rank for sorting
            let rank = 4; // Default: town/village
            let regionType = 'Town';

            if (addr.city || placeType === 'city') {
                rank = 2;
                regionType = 'City';
            } else if (addr.state_district || addr.district || placeType === 'administrative') {
                rank = 3;
                regionType = 'District';
            } else if (addr.village || addr.hamlet) {
                rank = 5;
                regionType = 'Village';
            }

            // Boost rank if name starts with query
            if (cityName.toLowerCase().startsWith(qLower)) {
                rank -= 0.5;
            }

            seenNames.add(cleanDisplayName.toLowerCase());
            apiMatches.push({
                lat: item.lat,
                lon: item.lon,
                cleanName: cleanDisplayName,
                regionType: regionType,
                rank: rank
            });
        });
    }

    // Sort: Rank 1 (Major Cities) -> Rank 2 (Cities) -> Rank 3 (Districts) -> Rank 4 (Towns) -> Rank 5 (Rural)
    apiMatches.sort((a, b) => a.rank - b.rank);
    const combinedResults = [...localMatches, ...apiMatches];

    if (combinedResults.length === 0) {
        suggestionsBox.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">No matching regions found</div>`;
        suggestionsBox.classList.remove('hidden');
        return;
    }

    renderFormattedSuggestions(combinedResults);
}

function renderFormattedSuggestions(items) {
    const suggestionsBox = document.getElementById('search-suggestions');
    if (!suggestionsBox) return;

    suggestionsBox.innerHTML = items.map(item => `
        <div class="suggestion-item" onclick="selectSearchResult(${item.lat}, ${item.lon}, '${item.cleanName.replace(/'/g, "\\'")}')">
            <i data-lucide="map-pin" class="w-3.5 h-3.5 text-teal-400 shrink-0"></i>
            <span class="truncate font-medium flex-1 text-slate-200">${item.cleanName}</span>
            <span class="text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
                item.regionType === 'Major City' || item.regionType === 'City' 
                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' 
                : 'bg-slate-800 text-slate-400 border border-slate-700'
            }">${item.regionType}</span>
        </div>
    `).join('');

    suggestionsBox.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function selectSearchResult(lat, lon, cleanName) {
    const searchInput = document.getElementById('city-search-input');
    const suggestionsBox = document.getElementById('search-suggestions');
    
    if (searchInput) searchInput.value = cleanName;
    suggestionsBox?.classList.add('hidden');

    const coordX = document.getElementById('coord-x');
    const coordY = document.getElementById('coord-y');
    if (coordX) coordX.value = parseFloat(lon).toFixed(4);
    if (coordY) coordY.value = parseFloat(lat).toFixed(4);

    mapRoiPicker.setView([lat, lon], 11);

    L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: "#14b8a6",
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    }).addTo(mapRoiPicker).bindPopup(`<b class="text-slate-900">${cleanName}</b>`).openPopup();
}

function clearCitySearch() {
    const searchInput = document.getElementById('city-search-input');
    const clearBtn = document.getElementById('clear-search-btn');
    const suggestionsBox = document.getElementById('search-suggestions');

    if (searchInput) searchInput.value = '';
    clearBtn?.classList.add('hidden');
    suggestionsBox?.classList.add('hidden');
}

function initOutputMaps() {
    const defaultCoords = [20.5937, 78.9629];
    const baseTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileOptions = { 
        maxZoom: 19, 
        attribution: '&copy; OpenStreetMap contributors' 
    };

    mapBuiltStart = L.map('map-built-start', { zoomControl: false }).setView(defaultCoords, 11);
    L.tileLayer(baseTileUrl, tileOptions).addTo(mapBuiltStart);

    mapBuiltEnd = L.map('map-built-end', { zoomControl: false }).setView(defaultCoords, 11);
    L.tileLayer(baseTileUrl, tileOptions).addTo(mapBuiltEnd);

    mapLSTStart = L.map('map-lst-start', { zoomControl: false }).setView(defaultCoords, 11);
    L.tileLayer(baseTileUrl, tileOptions).addTo(mapLSTStart);

    mapLSTEnd = L.map('map-lst-end', { zoomControl: false }).setView(defaultCoords, 11);
    L.tileLayer(baseTileUrl, tileOptions).addTo(mapLSTEnd);

    builtStartLayers = L.layerGroup().addTo(mapBuiltStart);
    builtEndLayers = L.layerGroup().addTo(mapBuiltEnd);
    lstStartLayers = L.layerGroup().addTo(mapLSTStart);
    lstEndLayers = L.layerGroup().addTo(mapLSTEnd);

    const outputMaps = [mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd];
    let isSyncing = false;

    outputMaps.forEach(source => {
        source.on('move', () => {
            if (isSyncing) return;
            isSyncing = true;
            const center = source.getCenter();
            const zoom = source.getZoom();
            outputMaps.forEach(target => {
                if (target !== source) target.setView(center, zoom, { animate: false });
            });
            isSyncing = false;
        });
    });
}

function clearAllAnalysisLayers() {
    [builtStartLayers, builtEndLayers, lstStartLayers, lstEndLayers].forEach(l => l && l.clearLayers());
    activeLayers = { 'built-start': [], 'built-end': [], 'lst-start': [], 'lst-end': [] };
}

function updateMapOpacity(mapKey, value) {
    const val = parseFloat(value);
    const layers = activeLayers[mapKey] || [];
    layers.forEach(layer => {
        if (layer.setOpacity) layer.setOpacity(val);
    });
}


function resetToRoiPicker() {
    document.getElementById('analysis-results-section')?.classList.add('hidden');
    document.getElementById('roi-definition-section')?.classList.remove('hidden');
    setTimeout(() => mapRoiPicker.invalidateSize(), 150);
    openSidebar();
}

function updateAnalysisProgress(percent, statusMessage) {
    const progressBar = document.getElementById('loading-progress-bar');
    const progressPercent = document.getElementById('loading-progress-percent');
    const statusText = document.getElementById('loading-status-text');

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.innerText = `${percent}%`;
    if (statusText) statusText.innerText = statusMessage;
}
// Function to update progress strictly after a step finishes
function completeStep(currentStep, totalSteps, statusMessage) {
    const progressBar = document.getElementById('loading-progress-bar');
    const progressPercent = document.getElementById('loading-progress-percent');
    const statusText = document.getElementById('loading-status-text');

    const percent = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.innerText = `${percent}%`;
    if (statusText) statusText.innerText = `[Step ${currentStep}/${totalSteps}] ${statusMessage}`;
}

async function executeFullAnalysis() {
    const startYear = parseInt(document.getElementById('start-year')?.value || 2000, 10);
    const endYear = parseInt(document.getElementById('end-year')?.value || 2025, 10);
    const regionName = document.getElementById('select-region')?.value || 'Agra';
    const xCoord = parseFloat(document.getElementById('coord-x')?.value || 78.0081);
    const yCoord = parseFloat(document.getElementById('coord-y')?.value || 27.1767);

    if (startYear > endYear) {
        alert(`Start year (${startYear}) cannot be greater than End year (${endYear}).`);
        return;
    }

    // Define distinct sequential steps
   const steps = [
        { msg: "Initializing Region of Interest (ROI) and geometry boundaries...", action: async () => {
            if (currentMode === 'region') {
                centerRoiPickerOnSelectedRegion();
            } else if (currentMode === 'coordinates') {
                updateRoiFromCoordinates();
            }

            if (!currentRoiPolygon || currentRoiPolygon.length === 0) {
                if (MAJOR_INDIAN_CITIES[regionName]) {
                    const [cLat, cLon] = MAJOR_INDIAN_CITIES[regionName];
                    currentRoiPolygon = createBoundingPolygonFromCoords(cLat, cLon, 0.06);
                } else {
                    currentRoiPolygon = createBoundingPolygonFromCoords(yCoord, xCoord, 0.05);
                }
            }
            updateBufferedBoundsFromPolygon(currentRoiPolygon);
        }},
        { msg: "Preparing analysis UI layout and clearing previous layers...", action: async () => {
            document.getElementById('lbl-built-1').innerText = `LULC CLASSIFICATION – ${startYear}`;
            document.getElementById('lbl-built-2').innerText = `LULC CLASSIFICATION – ${endYear}`;
            document.getElementById('lbl-lst-1').innerText = `LST HEATMAP – ${startYear}`;
            document.getElementById('lbl-lst-2').innerText = `LST HEATMAP – ${endYear}`;

            if (typeof clearAllAnalysisLayers === 'function') {
                clearAllAnalysisLayers();
            }
        }},
        { msg: `Extracting multi-spectral composites for ${startYear} and ${endYear}...`, action: async () => {
            await new Promise(r => setTimeout(r, 200));
        }},
        { msg: "Running Land Use Land Cover (LULC) classification models...", action: async () => {
            await new Promise(r => setTimeout(r, 250));
        }},
        { msg: "Computing Land Surface Temperature (LST) heatmaps & SUHI metrics...", action: async () => {
            await new Promise(r => setTimeout(r, 250));
        }},
        { msg: "Executing backend analysis query on Google Earth Engine...", action: async () => {
            const payload = {
                roi_mode: currentMode,
                start_year: startYear,
                end_year: endYear,
                region_name: regionName,
                x: xCoord,
                y: yCoord,
                polygon_coords: currentRoiPolygon
            };

            // Use a smooth micro-ticker during the GEE fetch phase so it glides smoothly 
            // instead of freezing, perfectly matching the terminal execution flow.
            const fetchPromise = fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(res => res.json());

            window._cachedAnalysisResult = await fetchPromise;
        }},
        { msg: "Processing response data and formatting metrics...", action: async () => {
            const result = window._cachedAnalysisResult;
            if (!result || !result.success) {
                throw new Error(result?.error || result?.warning || result?.message || "GEE computation error");
            }
        }},
        { msg: "Finalizing dashboard maps and charts...", action: async () => {
            const result = window._cachedAnalysisResult;
            
            document.getElementById('roi-definition-section')?.classList.add('hidden');
            document.getElementById('analysis-results-section')?.classList.remove('hidden');

            if (typeof switchChartTab === 'function') {
                switchChartTab('trend');
            }

            setTimeout(() => {
                [mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd].forEach(m => m && m.invalidateSize());
                renderAnalysisLayers(result);
            }, 100);

            if (typeof updateDashboardMetrics === 'function') {
                updateDashboardMetrics(result);
            }
            updateAnalyticsCharts(result);

            if (typeof closeSidebar === 'function') {
                closeSidebar();
            }
        }}
    ];
    

    const totalSteps = steps.length;
    let currentStep = 0;

    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay?.classList.remove('hidden');
    loadingOverlay?.classList.add('flex');

    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = `Analyzing ${regionName}...`;
    }

    try {
        // Execute each step one by one, updating progress ONLY AFTER completion
        for (let i = 0; i < steps.length; i++) {
            currentStep = i + 1;
            
            // Run the step task
            await steps[i].action();

            // Update percentage and text strictly AFTER the step finishes
            completeStep(currentStep, totalSteps, steps[i].msg);
            
            // Brief pause so the user can visually register the completion of each step
            await new Promise(r => setTimeout(r, 200));
        }

        // Hide overlay after a brief final delay
        setTimeout(() => {
            loadingOverlay?.classList.add('hidden');
            loadingOverlay?.classList.remove('flex');
        }, 400);

    } catch (err) {
        loadingOverlay?.classList.add('hidden');
        loadingOverlay?.classList.remove('flex');
        console.error('Error during analysis sequence:', err);
        alert('Analysis failed: ' + err.message);
    } finally {
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<i data-lucide="trending-up" class="w-5 h-5"></i><span>Quantify SUHI & Growth</span>`;
            if (window.lucide) lucide.createIcons();
        }
    }
}


function updateDashboardMetrics(data) {
    if (!data || !data.statistics) return;

    const stats = data.statistics;

    // 1. Update Spatio-Temporal Metrics Panel (Mapped to match backend keys)
    const areaStartEl = document.getElementById('stat-area-start');
    const areaEndEl = document.getElementById('stat-area-end');
    const agrEl = document.getElementById('stat-agr');
    const shiftEl = document.getElementById('stat-shift');
    const suhiEl = document.getElementById('stat-suhi-intensity');
    const regR2El = document.getElementById('stat-reg-r2');
    const corrREl = document.getElementById('stat-corr-r');

    const startArea = stats.start_built_area !== undefined ? stats.start_built_area : stats.start_area_km2;
    const endArea = stats.target_built_area !== undefined ? stats.target_built_area : stats.end_area_km2;
    const regR2 = stats.regression_r2 !== undefined ? stats.regression_r2 : (stats.regression ? stats.regression.r2 : '--');
    const pixelCorr = stats.pixel_correlation !== undefined ? stats.pixel_correlation : stats.correlation_r;

    if (areaStartEl) areaStartEl.innerText = `${startArea} km²`;
    if (areaEndEl) areaEndEl.innerText = `${endArea} km²`;
    if (agrEl) agrEl.innerText = `${stats.annual_growth_rate}% / yr`;
    if (shiftEl) shiftEl.innerText = `${stats.centroid_shift_km} km (${stats.expansion_vector})`;
    if (suhiEl) suhiEl.innerText = `+${stats.suhi_intensity} °C`;
    if (regR2El) regR2El.innerText = `${regR2}`;
    if (corrREl) corrREl.innerText = `${pixelCorr}`;

    // 2. Synchronize Time-Series Chart (Consecutive Annual Trends)
    if (trendChartInstance && data.trends) {
        trendChartInstance.data.labels = data.trends.labels || [];
        trendChartInstance.data.datasets[0].data = data.trends.suhi_series || [];
        trendChartInstance.data.datasets[1].data = data.trends.built_area_km2 || data.trends.builtup_series || [];
        trendChartInstance.update();
    }

    // 3. Synchronize Scatter & Linear Regression Fit
// 3. Synchronize Scatter & Linear Regression Fit
// 3. Synchronize Scatter & Linear Regression Fit
    if (scatterChartInstance && data.trends) {
        const builtAreas = data.trends.built_area_km2 || data.trends.builtup_series || [];
        const suhiSeries = data.trends.suhi_series || [];

        const scatterPoints = builtAreas.map((area, i) => ({
            x: Number(area),
            y: Number(suhiSeries[i])
        }));

        scatterChartInstance.data.datasets[0].data = scatterPoints;

        let linePoints = [];
        if (builtAreas.length > 0) {
            const minX = Math.min(...builtAreas);
            const maxX = Math.max(...builtAreas);
            
            if (data.trends.regression_line && data.trends.regression_line.length === builtAreas.length) {
                linePoints = builtAreas.map((xVal, i) => ({
                    x: Number(xVal),
                    y: Number(data.trends.regression_line[i])
                }));
            } else {
                const slope = Number(stats.regression?.slope || 0.05);
                const intercept = Number(stats.regression?.intercept || 2.0);
                linePoints = [
                    { x: minX, y: parseFloat((slope * minX + intercept).toFixed(2)) },
                    { x: maxX, y: parseFloat((slope * maxX + intercept).toFixed(2)) }
                ];
            }
        }
        scatterChartInstance.data.datasets[1].data = linePoints;

        // FORCE dynamic scaling bounds based on actual data values
        if (builtAreas.length > 0 && suhiSeries.length > 0) {
            const minX = Math.min(...builtAreas);
            const maxX = Math.max(...builtAreas);
            const minY = Math.min(...suhiSeries);
            const maxY = Math.max(...suhiSeries);

            // Add a small 5% padding so points don't touch the graph borders
            const xPad = (maxX - minX) * 0.05 || 10;
            const yPad = (maxY - minY) * 0.05 || 0.5;

            scatterChartInstance.options.scales.x.min = minX - xPad;
            scatterChartInstance.options.scales.x.max = maxX + xPad;
            scatterChartInstance.options.scales.y.min = minY - yPad;
            scatterChartInstance.options.scales.y.max = maxY + yPad;
        }

        scatterChartInstance.update();
    }
}

function renderAnalysisLayers(result) {
    const coords = result.parameters.roi;
    if (!coords || coords.length === 0) return;
    const latLngs = coords.map(c => [c[1], c[0]]);

    const opBuiltStart = parseFloat(document.getElementById('opacity-built-start')?.value || 1.00);
    const opBuiltEnd = parseFloat(document.getElementById('opacity-built-end')?.value || 1.00);
    const opLstStart = parseFloat(document.getElementById('opacity-lst-start')?.value || 1.00);
    const opLstEnd = parseFloat(document.getElementById('opacity-lst-end')?.value || 1.00);
    const cb = `?t=${Date.now()}`;

    if (result.tile_urls) {
        if (result.tile_urls.lulc_start) {
            const t1 = L.tileLayer(result.tile_urls.lulc_start + cb, { maxZoom: 18, opacity: opBuiltStart }).addTo(builtStartLayers);
            activeLayers['built-start'].push(t1);
        }
        if (result.tile_urls.lulc_end) {
            const t2 = L.tileLayer(result.tile_urls.lulc_end + cb, { maxZoom: 18, opacity: opBuiltEnd }).addTo(builtEndLayers);
            activeLayers['built-end'].push(t2);
        }
        if (result.tile_urls.lst_start) {
            const t3 = L.tileLayer(result.tile_urls.lst_start + cb, { maxZoom: 18, opacity: opLstStart }).addTo(lstStartLayers);
            activeLayers['lst-start'].push(t3);
        }
        if (result.tile_urls.lst_end) {
            const t4 = L.tileLayer(result.tile_urls.lst_end + cb, { maxZoom: 18, opacity: opLstEnd }).addTo(lstEndLayers);
            activeLayers['lst-end'].push(t4);
        }
    }

    const boundaryPoly = L.polygon(latLngs, { color: '#38bdf8', weight: 2, fillOpacity: 0.0 }).addTo(builtStartLayers);
    L.polygon(latLngs, { color: '#38bdf8', weight: 2, fillOpacity: 0.0 }).addTo(builtEndLayers);
    L.polygon(latLngs, { color: '#f59e0b', weight: 2, fillOpacity: 0.0 }).addTo(lstStartLayers);
    L.polygon(latLngs, { color: '#f59e0b', weight: 2, fillOpacity: 0.0 }).addTo(lstEndLayers);

    const bounds = boundaryPoly.getBounds();
    [mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd].forEach(m => {
        m.fitBounds(bounds, { padding: [20, 20], animate: false });
    });
}

function switchChartTab(tab) {
    const trendCanvas = document.getElementById('suhiTrendChart');
    const scatterCanvas = document.getElementById('suhiScatterChart');
    const tabTrend = document.getElementById('tab-trend');
    const tabScatter = document.getElementById('tab-scatter');

    if (!trendCanvas || !scatterCanvas || !tabTrend || !tabScatter) return;

    if (tab === 'trend') {
        trendCanvas.classList.remove('hidden');
        trendCanvas.style.display = 'block';
        scatterCanvas.classList.add('hidden');
        scatterCanvas.style.display = 'none';

        tabTrend.classList.add('bg-teal-600', 'text-white');
        tabTrend.classList.remove('bg-slate-800', 'text-slate-300');
        tabScatter.classList.remove('bg-teal-600', 'text-white');
        tabScatter.classList.add('bg-slate-800', 'text-slate-300');

        if (window.trendChartInstance) {
            window.trendChartInstance.resize();
            window.trendChartInstance.update();
        }
    } else if (tab === 'scatter') {
        trendCanvas.classList.add('hidden');
        trendCanvas.style.display = 'none';
        scatterCanvas.classList.remove('hidden');
        scatterCanvas.style.display = 'block';

        tabScatter.classList.add('bg-teal-600', 'text-white');
        tabScatter.classList.remove('bg-slate-800', 'text-slate-300');
        tabTrend.classList.remove('bg-teal-600', 'text-white');
        tabTrend.classList.add('bg-slate-800', 'text-slate-300');

        // Give the DOM a tiny moment to unhide the canvas before resizing/updating Chart.js
        setTimeout(() => {
            if (window.scatterChartInstance) {
                window.scatterChartInstance.resize();
                window.scatterChartInstance.update();
            }
        }, 50);
    }
}

function initAnalyticsCharts() {
    // 1. Time-Series Trend Chart (Dynamic annual progression)
    const ctxTrend = document.getElementById('suhiTrendChart')?.getContext('2d');
    if (ctxTrend) {
        // Destroy prior instance if re-initializing to avoid duplicate renders
        if (window.trendChartInstance) {
            window.trendChartInstance.destroy();
        }

        window.trendChartInstance = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: [], // Populated dynamically by updateCharts(data.trends.labels)
                datasets: [
                    {
                        label: 'SUHI Intensity (°C)',
                        data: [],
                        borderColor: '#f97316',
                        backgroundColor: 'rgba(249, 115, 22, 0.15)',
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#f97316',
                        borderWidth: 2,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Built-up Area (km²)',
                        data: [],
                        borderColor: '#14b8a6',
                        backgroundColor: 'rgba(20, 184, 166, 0.15)',
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#14b8a6',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        grid: { color: '#1e293b' },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10 },
                            autoSkip: true,
                            maxRotation: 0,
                            maxTicksLimit: 12 // Prevents crowded labels on large date ranges
                        }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: '#1e293b' },
                        ticks: {
                            color: '#f97316',
                            callback: val => `${val} °C`
                        }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#14b8a6',
                            callback: val => `${val} km²`
                        }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#cbd5e1',
                            font: { size: 11, weight: 'bold' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        titleColor: '#2dd4bf',
                        borderColor: '#334155',
                        borderWidth: 1
                    }
                }
            }
        });
    }
    // 2. Scatter & Regression Chart (Configured as a linear line chart to safely mix scatter points and lines)
    const ctxScatter = document.getElementById('suhiScatterChart')?.getContext('2d');
    if (ctxScatter) {
        if (window.scatterChartInstance) {
            window.scatterChartInstance.destroy();
        }

        window.scatterChartInstance = new Chart(ctxScatter, {
            type: 'line', // Using 'line' base type avoids mixed-controller scaling bugs in Chart.js
            data: {
                datasets: [
                    {
                        label: 'Annual Epoch Observations',
                        data: [],
                        type: 'scatter', // Explicitly declare dataset 1 as scatter points
                        backgroundColor: '#38bdf8',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: 'Linear Regression Trend',
                        data: [],
                        type: 'line', // Dataset 2 is the continuous trend line
                        borderColor: '#f43f5e',
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear', // Force linear scale for coordinate mapping
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Built-up Area (km²)',
                            color: '#94a3b8',
                            font: { size: 10 }
                        },
                        grid: { color: '#1e293b' },
                        ticks: { color: '#94a3b8' }
                    },
                    y: {
                        type: 'linear',
                        title: {
                            display: true,
                            text: 'SUHI Intensity (°C)',
                            color: '#94a3b8',
                            font: { size: 10 }
                        },
                        grid: { color: '#1e293b' },
                        ticks: { color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#cbd5e1',
                            font: { size: 11, weight: 'bold' }
                        }
                    }
                }
            }
        });
    }
}

function downloadPDFReport() {
    const element = document.getElementById('printable-report');
    if (!element) return;
    const opt = {
        margin: 0.3,
        filename: `SUHI_Spatial_Growth_Report_${new Date().toISOString().slice(0,10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#020617' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
    };
    html2pdf().set(opt).from(element).save();
}

// Bulletproof Area Calculation
function calculatePolygonAreaKm2(coords) {
    if (!coords || !Array.isArray(coords) || coords.length < 3) return 0;

    let ring = coords;
    while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0][0])) {
        ring = ring[0];
    }

    const n = ring.length;
    if (n < 3) return 0;

    // Estimate latitude to project meters accurately
    const meanLat = ring.reduce((acc, pt) => acc + (parseFloat(pt[1]) || 0), 0) / n;
    const latMeters = 111132.954;
    const lonMeters = 111412.84 * Math.cos(meanLat * (Math.PI / 180));

    let area = 0;
    for (let i = 0; i < n - 1; i++) {
        const x1 = parseFloat(ring[i][0]) * lonMeters;
        const y1 = parseFloat(ring[i][1]) * latMeters;
        const x2 = parseFloat(ring[i + 1][0]) * lonMeters;
        const y2 = parseFloat(ring[i + 1][1]) * latMeters;
        area += (x1 * y2 - x2 * y1);
    }

    return Math.abs(area / 2.0) / 1e6; // Convert m² to km²
}

// Show/Hide Warning Banner
function checkAoiAreaWarning(coords) {
    const banner = document.getElementById('aoi-warning-banner');
    const areaVal = document.getElementById('aoi-area-val');
    if (!banner) {
        console.error("Could not find element #aoi-warning-banner in the DOM.");
        return;
    }

    const areaKm2 = calculatePolygonAreaKm2(coords);
    console.log(`[AOI Check] Calculated Area: ${Math.round(areaKm2)} km²`);

    if (areaVal) areaVal.textContent = Math.round(areaKm2);

    // 10 km x 10 km = 100 km² threshold
    if (areaKm2 > 100) {
        banner.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    } else {
        banner.style.display = 'none';
    }
}

let activeFullscreenCardId = null;
let activeFullscreenMapInstance = null;

/**
 * Toggles a map container into full-screen view and recalculates leaflet tile dimensions.
 */
function toggleMapFullscreen(cardId, mapInstance) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // If already in fullscreen, exit
    if (activeFullscreenCardId === cardId) {
        exitMapFullscreen();
        return;
    }

    // Clean up if another card was already fullscreen
    if (activeFullscreenCardId) {
        exitMapFullscreen();
    }

    activeFullscreenCardId = cardId;
    activeFullscreenMapInstance = mapInstance;

    card.classList.add('map-card-fullscreen');
    document.body.style.overflow = 'hidden'; // Prevent page scrolling while in fullscreen

    // Crucial for Leaflet: forces re-rendering to the new expanded container width & height
    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
        if (window.lucide) lucide.createIcons();
    }, 150);
}

/**
 * Reverts the map back to its grid location and refits Leaflet viewport.
 */
function exitMapFullscreen() {
    if (!activeFullscreenCardId) return;

    const card = document.getElementById(activeFullscreenCardId);
    if (card) {
        card.classList.remove('map-card-fullscreen');
    }

    document.body.style.overflow = ''; // Restore page scrolling

    const mapInstance = activeFullscreenMapInstance;
    activeFullscreenCardId = null;
    activeFullscreenMapInstance = null;

    // Recalculate leaflet tile layout back to original grid size
    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
    }, 150);
}

// Global Keyboard Listener: Esc Key Exits Fullscreen
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
        if (activeFullscreenCardId) {
            exitMapFullscreen();
        }
    }
});

function updateAnalyticsCharts(result) {
    // Resolve payload wrapping whether Flask sends result or result.data
    const payload = result.data ? result.data : result;
    const trends = payload.trends;
    const stats = payload.statistics || payload.stats;

    if (!trends || !trends.labels || trends.labels.length === 0) {
        console.warn("[Chart Warning] No trends data in response:", result);
        return;
    }

    // 1. Update Time-Series Trend Line Chart
    if (window.trendChartInstance) {
        window.trendChartInstance.data.labels = trends.labels;
        // Dataset 0: SUHI Intensity (°C)
        window.trendChartInstance.data.datasets[0].data = trends.suhi_series;
        // Dataset 1: Built-up Area (km²)
        window.trendChartInstance.data.datasets[1].data = trends.built_area_km2;

        window.trendChartInstance.resize();
        window.trendChartInstance.update();
    }

    // 2. Update Scatter & Regression Chart
    if (window.scatterChartInstance && trends.built_area_km2 && trends.suhi_series) {
        const builtSeries = trends.built_area_km2;
        const suhiSeries = trends.suhi_series;

        // Map observations to {x, y}
        const scatterPoints = builtSeries.map((area, idx) => ({
            x: Number(area),
            y: Number(suhiSeries[idx])
        }));

        let regressionPoints = [];

        // Check if backend already sent a pre-calculated regression line
        if (trends.regression_line && trends.regression_line.length === builtSeries.length) {
            regressionPoints = builtSeries.map((xVal, idx) => ({
                x: Number(xVal),
                y: Number(trends.regression_line[idx])
            }));
        } else {
            // Fallback: Compute min/max endpoints or use stats if available
            const minX = Math.min(...builtSeries);
            const maxX = Math.max(...builtSeries);
            const slope = Number(stats?.slope || 0.05);
            const intercept = Number(stats?.intercept || 2.0);
            
            regressionPoints = [
                { x: minX, y: Number((slope * minX + intercept).toFixed(2)) },
                { x: maxX, y: Number((slope * maxX + intercept).toFixed(2)) }
            ];
        }

        window.scatterChartInstance.data.datasets[0].data = scatterPoints;
        window.scatterChartInstance.data.datasets[1].data = regressionPoints;

        // Optional: Dynamically adjust scale boundaries so points don't clip
        const minX = Math.min(...builtSeries);
        const maxX = Math.max(...builtSeries);
        const minY = Math.min(...suhiSeries);
        const maxY = Math.max(...suhiSeries);
        const xPad = (maxX - minX) * 0.05 || 10;
        const yPad = (maxY - minY) * 0.05 || 0.5;

        window.scatterChartInstance.options.scales.x.min = minX - xPad;
        window.scatterChartInstance.options.scales.x.max = maxX + xPad;
        window.scatterChartInstance.options.scales.y.min = minY - yPad;
        window.scatterChartInstance.options.scales.y.max = maxY + yPad;

        window.scatterChartInstance.resize();
        window.scatterChartInstance.update();
        console.log("[Chart Success] Scatter and regression graphs updated successfully.");
    }
}

/**
 * Calculates bounds from ROI polygon and adds a ~10 km buffer (approx 0.09 degrees).
 */
function updateBufferedBoundsFromPolygon(coords) {
    if (!coords || coords.length === 0) {
        window.roiBufferedBounds = null;
        return;
    }
    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
    const latLngs = coords.map(c => [c[1], c[0]]);
    const poly = L.polygon(latLngs);
    const bounds = poly.getBounds();
    
    // 10 km buffer in degrees (approx 0.09°)
    const bufferDeg = 0.09; 
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    
    window.roiBufferedBounds = L.latLngBounds(
        L.latLng(southWest.lat - bufferDeg, southWest.lng - bufferDeg),
        L.latLng(northEast.lat + bufferDeg, northEast.lng + bufferDeg)
    );
}

/**
 * Captures and downloads strictly the map container view fitted to the ROI + buffer.
 * @param {string} mapDivId - The DOM ID of the Leaflet map container (e.g., 'map-built-start').
 * @param {string} filenamePrefix - Prefix for the downloaded image filename.
 * @param {object} mapInstance - The Leaflet map instance.
 */
function downloadMapCard(mapDivId, filenamePrefix, mapInstance) {
    const mapElement = document.getElementById(mapDivId);
    if (!mapElement) return;

    if (!mapInstance) {
        alert("Map instance not initialized.");
        return;
    }

    // 1. Validate and apply the stored ROI + buffer bounds
    if (window.roiBufferedBounds) {
        mapInstance.fitBounds(window.roiBufferedBounds, { animate: false });
    } else if (window.roiLayer && typeof window.roiLayer.getBounds === 'function') {
        mapInstance.fitBounds(window.roiLayer.getBounds().pad(0.15), { animate: false });
    } else {
        alert("Please define your study region in Step 1 before downloading maps.");
        return;
    }

    // 2. Force Leaflet to re-calculate layout and load tiles for the exact ROI box
    mapInstance.invalidateSize();

    // 3. Wait slightly for tiles to paint, then execute html2canvas snapshot
    setTimeout(() => {
        html2canvas(mapElement, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#0f172a',
            scale: 2 // Crisp high-resolution export
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${filenamePrefix}_ROI_${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            console.error("Error generating map snapshot:", err);
            alert("Failed to download map image.");
        });
    }, 800);
}


/**
 * Switches between the Dashboard view and the About Us page view.
 * @param {string} view - 'dashboard' or 'about'
 */
function switchView(view) {
    const roiSection = document.getElementById('roi-definition-section');
    const resultsSection = document.getElementById('analysis-results-section');
    const aboutSection = document.getElementById('about-us-section');

    const navDashboard = document.getElementById('nav-dashboard');
    const navAbout = document.getElementById('nav-about');

    navDashboard?.classList.remove('active-nav');
    navAbout?.classList.remove('active-nav');

    if (view === 'about') {
        roiSection?.classList.add('hidden');
        resultsSection?.classList.add('hidden');
        aboutSection?.classList.remove('hidden');
        navAbout?.classList.add('active-nav');
        
        // Collapse sidebar only when About Us is clicked
        if (typeof closeSidebar === 'function') {
            closeSidebar();
        }
    } else {
        aboutSection?.classList.add('hidden');
        navDashboard?.classList.add('active-nav');

        const hasResults = window.trendChartInstance && window.trendChartInstance.data.labels.length > 0;
        if (hasResults) {
            resultsSection?.classList.remove('hidden');
        } else {
            roiSection?.classList.remove('hidden');
        }

        // Explicitly open the sidebar when switching back to the dashboard
        if (typeof openSidebar === 'function') {
            openSidebar();
        }

        setTimeout(() => {
            if (window.mapRoiPicker) window.mapRoiPicker.invalidateSize();
        }, 150);
    }
}


function logout() {
    localStorage.removeItem('active_session_user');
    fetch('/api/auth/logout', { method: 'POST' }).then(() => {
        window.location.href = '/login';
    });
}