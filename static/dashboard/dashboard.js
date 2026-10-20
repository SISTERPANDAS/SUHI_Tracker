let mapRoiPicker;
let mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd;
let drawnItems = null;
let drawControl = null;
let currentRoiPolygon = null;
let currentMode = 'region';
let trendChartInstance = null;
let scatterChartInstance = null;
//let currentCoordType = 'point';

// Global AbortController to handle backend cancellation
let activeAnalysisController = null;

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

function updateRoiFromCoordinates() {
    let polygonCoords = [];

    if (currentCoordType === 'single') {
        const latInput = document.getElementById('single-lat');
        const lonInput = document.getElementById('single-lon');
        const latDir = document.getElementById('single-lat-dir')?.value || 'N';
        const lonDir = document.getElementById('single-lon-dir')?.value || 'E';
        const shape = document.getElementById('zone-shape')?.value || 'square';
        const sizeKm = parseFloat(document.getElementById('zone-size-km')?.value || 10);

        if (!latInput || !lonInput) return;

        let lat = parseFloat(latInput.value);
        let lon = parseFloat(lonInput.value);

        if (isNaN(lat) || isNaN(lon)) return;

        if (latDir === 'S') lat = -Math.abs(lat);
        else lat = Math.abs(lat);

        if (lonDir === 'W') lon = -Math.abs(lon);
        else lon = Math.abs(lon);

        if (mapRoiPicker) {
            mapRoiPicker.setView([lat, lon], 11);
        }

        // Convert km size to approximate degrees (1 degree ~ 111 km)
        const halfSpan = (sizeKm / 2) / 111.0;

        if (shape === 'square') {
            const west = lon - halfSpan;
            const east = lon + halfSpan;
            const south = lat - halfSpan;
            const north = lat + halfSpan;

            polygonCoords = [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south]
            ];

            if (drawnItems) {
                drawnItems.clearLayers();
                const rectLayer = L.rectangle([[south, west], [north, east]], {
                    color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.25, weight: 2
                });
                drawnItems.addLayer(rectLayer);
            }
        } else {
            // Circle shape represented as approximated polygon (diameter = sizeKm)
            const radiusDeg = halfSpan;
            const pointsCount = 32;
            polygonCoords = [];
            const leafletCirclePoints = [];

            for (let i = 0; i <= pointsCount; i++) {
                const angle = (i / pointsCount) * 2 * Math.PI;
                const pLon = lon + radiusDeg * Math.cos(angle);
                const pLat = lat + radiusDeg * Math.sin(angle);
                polygonCoords.push([pLon, pLat]);
                leafletCirclePoints.push([pLat, pLon]);
            }

            if (drawnItems) {
                drawnItems.clearLayers();
                const circleLayer = L.polygon(leafletCirclePoints, {
                    color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.25, weight: 2
                });
                drawnItems.addLayer(circleLayer);
            }
        }

    } else {
        // Multiple points selection (Matrix structure)
        const rowElements = document.querySelectorAll('.vector-row');
        if (rowElements.length < 4) return;

        const leafletPolygonPoints = [];
        polygonCoords = [];

        rowElements.forEach(row => {
            const latVal = parseFloat(row.querySelector('.vector-lat').value);
            const lonVal = parseFloat(row.querySelector('.vector-lon').value);
            if (!isNaN(latVal) && !isNaN(lonVal)) {
                leafletPolygonPoints.push([latVal, lonVal]);
                polygonCoords.push([lonVal, latVal]);
            }
        });

        if (polygonCoords.length >= 4) {
            // Close boundary by connecting back to the first point
            polygonCoords.push([...polygonCoords[0]]);
            leafletPolygonPoints.push([...leafletPolygonPoints[0]]);

            if (mapRoiPicker && leafletPolygonPoints.length > 0) {
                mapRoiPicker.setView(leafletPolygonPoints[0], 10);
            }

            if (drawnItems) {
                drawnItems.clearLayers();
                const polyLayer = L.polygon(leafletPolygonPoints, {
                    color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.25, weight: 2
                });
                drawnItems.addLayer(polyLayer);
            }
        }
    }

    currentRoiPolygon = polygonCoords;
    if (typeof checkAoiAreaWarning === 'function') {
        checkAoiAreaWarning(currentRoiPolygon);
    }
}

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
    if (window.lucide) lucide.createIcons();
    initRoiPickerMap();
    initOutputMaps();
    initAnalyticsCharts();
    initCitySearchBar();

    if (typeof switchChartTab === 'function') {
        switchChartTab('trend');
    }
    document.getElementById('select-region')?.addEventListener('change', centerRoiPickerOnSelectedRegion);
    document.getElementById('coord-x')?.addEventListener('input', updateRoiFromCoordinates);
    document.getElementById('coord-y')?.addEventListener('input', updateRoiFromCoordinates);
    centerRoiPickerOnSelectedRegion();
    document.getElementById('tab-trend')?.addEventListener('click', () => switchChartTab('trend'));
    document.getElementById('tab-scatter')?.addEventListener('click', () => switchChartTab('scatter'));

    // Sidebar remains closed by default on page load

    document.getElementById('select-region')?.addEventListener('change', () => {
        if (typeof centerRoiPickerOnSelectedRegion === 'function') {
            centerRoiPickerOnSelectedRegion();
        }
    });

    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('main-sidebar');
        const toggleBtn = document.getElementById('sidebar-toggle-btn');
        const sidebarOpen = (typeof isSidebarOpen !== 'undefined') ? isSidebarOpen : false;

        if (sidebarOpen && sidebar && !sidebar.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
            if (typeof closeSidebar === 'function') {
                closeSidebar();
            }
        }

        const searchInput = document.getElementById('city-search-input');
        const suggestionsBox = document.getElementById('search-suggestions');

        if (suggestionsBox && !suggestionsBox.contains(e.target) && e.target !== searchInput) {
            suggestionsBox.classList.add('hidden');
        }
    });
});

// Handles expanding/collapsing the dashboard analysis controls section
function toggleDashboardAccordion() {
    const controlsContainer = document.getElementById('dashboard-controls-container');
    const chevron = document.getElementById('dashboard-chevron');
    const aboutSection = document.getElementById('about-us-section');
    const roiSection = document.getElementById('roi-definition-section');
    const resultsSection = document.getElementById('analysis-results-section');
    
    // Switch active nav styling
    document.getElementById('nav-dashboard')?.classList.add('active-nav', 'bg-slate-800', 'text-white');
    document.getElementById('nav-about')?.classList.remove('active-nav', 'bg-slate-800', 'text-white');

    // Ensure we are in dashboard view and hide About Us
    aboutSection?.classList.add('hidden');
    
    const hasResults = window.trendChartInstance && window.trendChartInstance.data.labels.length > 0;
    if (hasResults) {
        resultsSection?.classList.remove('hidden');
        roiSection?.classList.add('hidden');
    } else {
        roiSection?.classList.remove('hidden');
        resultsSection?.classList.add('hidden');
    }

    // Toggle expansion of the analysis controls container
    if (controlsContainer) {
        const isHidden = controlsContainer.classList.contains('hidden');
        if (isHidden) {
            controlsContainer.classList.remove('hidden');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
            if (typeof openSidebar === 'function') openSidebar();
        } else {
            controlsContainer.classList.add('hidden');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    }

    if (window.lucide) lucide.createIcons();
}

// Automatically contracts dashboard controls and switches view to About Us
function switchToAboutUs() {
    const controlsContainer = document.getElementById('dashboard-controls-container');
    const chevron = document.getElementById('dashboard-chevron');
    const aboutSection = document.getElementById('about-us-section');
    const roiSection = document.getElementById('roi-definition-section');
    const resultsSection = document.getElementById('analysis-results-section');

    // Switch active nav styling
    document.getElementById('nav-about')?.classList.add('active-nav', 'bg-slate-800', 'text-white');
    document.getElementById('nav-dashboard')?.classList.remove('active-nav', 'bg-slate-800', 'text-white');

    // Contract/hide dashboard analysis controls
    if (controlsContainer) {
        controlsContainer.classList.add('hidden');
        if (chevron) chevron.style.transform = 'rotate(0deg)';
    }

    // Hide dashboard content sections and show About Us
    roiSection?.classList.add('hidden');
    resultsSection?.classList.add('hidden');
    aboutSection?.classList.remove('hidden');

    if (typeof openSidebar === 'function') {
        openSidebar();
    }

    if (window.lucide) lucide.createIcons();
}

function switchSidebarTab(tab) {
    const controlsContainer = document.getElementById('dashboard-controls-container');
    const btnDashboard = document.getElementById('nav-dashboard');
    const btnAbout = document.getElementById('nav-about');

    const activeStyle = "background: rgba(20, 184, 166, 0.15); color: #2dd4bf; font-weight: 600;";
    const inactiveStyle = "background: transparent; color: #94a3b8; font-weight: 500;";

    if (tab === 'dashboard') {
        // Expand dashboard controls
        controlsContainer?.classList.remove('hidden');
        if (btnDashboard) btnDashboard.style.cssText = activeStyle;
        if (btnAbout) btnAbout.style.cssText = inactiveStyle;
        switchView('dashboard');
    } else if (tab === 'about') {
        // Contract/hide dashboard controls when About Us is active
        controlsContainer?.classList.add('hidden');
        if (btnAbout) btnAbout.style.cssText = activeStyle;
        if (btnDashboard) btnDashboard.style.cssText = inactiveStyle;
        switchView('about');
    }
    if (window.lucide) lucide.createIcons();
}

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

            if (typeof checkAoiAreaWarning === 'function') {
                checkAoiAreaWarning(currentRoiPolygon);
            }

            setRoiMode('draw');
            openSidebar();
        }
    });

    mapRoiPicker.on(L.Draw.Event.DELETED, function () {
        currentRoiPolygon = null;
        if (typeof checkAoiAreaWarning === 'function') {
            checkAoiAreaWarning(null);
        }
    });

    setTimeout(() => mapRoiPicker.invalidateSize(), 250);
}

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

            const isInvalid = ['building', 'amenity', 'shop', 'highway', 'tourism', 'leisure', 'apartments', 'residential'].includes(placeClass) ||
                              ['hotel', 'apartments', 'house', 'commercial', 'guest_house', 'parking'].includes(placeType);

            if (isInvalid) return;

            const cityName = addr.city || addr.town || addr.municipality || addr.state_district || addr.district || item.name;
            const stateName = addr.state || '';
            if (!cityName) return;

            const cleanDisplayName = stateName ? `${cityName}, ${stateName}` : cityName;
            if (seenNames.has(cleanDisplayName.toLowerCase())) return;

            let rank = 4;
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

function completeStep(currentStep, totalSteps, statusMessage) {
    const progressBar = document.getElementById('loading-progress-bar');
    const progressPercent = document.getElementById('loading-progress-percent');
    const statusText = document.getElementById('loading-status-text');

    const percent = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));

    if (progressBar) progressBar.style.width = `${percent}%`;
    if (progressPercent) progressPercent.innerText = `${percent}%`;
    if (statusText) statusText.innerText = `[Step ${currentStep}/${totalSteps}] ${statusMessage}`;
}

function calculateEstimatedTimeAndFrames(startYear, endYear, interval, polygonCoords) {
    const totalYears = (endYear - startYear) + 1;
    let totalFrames = totalYears;

    if (interval === 'monthly') totalFrames = totalYears * 12;
    else if (interval === 'seasonal') totalFrames = totalYears * 4;
    else if (interval === '5-yearly') totalFrames = Math.floor((endYear - startYear) / 5) + 1;

    const areaKm2 = Math.round(calculatePolygonAreaKm2(polygonCoords) || 100);
    const estimatedSeconds = Math.max(3, Math.round(totalFrames * (areaKm2 / 100) * 0.8));

    return {
        totalFrames,
        areaKm2,
        timeMessage: `Estimated time: ~${estimatedSeconds} seconds for ${totalFrames} frames across ~${areaKm2} km² scene dimensions.`
    };
}

function calculateComponentEstimates(startYear, endYear, interval, polygonCoords, components) {
    const totalYears = (endYear - startYear) + 1;
    let totalFrames = totalYears;

    if (interval === 'monthly') totalFrames = totalYears * 12;
    else if (interval === 'seasonal') totalFrames = totalYears * 4;
    else if (interval === '5-yearly') totalFrames = Math.floor((endYear - startYear) / 5) + 1;

    const areaKm2 = Math.round(calculatePolygonAreaKm2(polygonCoords) || 100);

    // Calculate individual times (approx. 0.8s per frame per active component)
    const factor = (areaKm2 / 100) * 0.8;
    const lulcSec = components.lulc ? Math.max(2, Math.round(totalFrames * factor * 0.7)) : 0;
    const lstSec = components.lst ? Math.max(2, Math.round(totalFrames * factor * 0.8)) : 0;
    const suhiSec = components.suhi ? Math.max(1, Math.round(totalFrames * factor * 0.4)) : 0;
    const graphsSec = components.graphs ? 2 : 0;

    const totalEstimatedSeconds = lulcSec + lstSec + suhiSec + graphsSec;

    let msg = `<div style="font-family: inherit; line-height: 1.6;">
        <div style="font-weight: 600; margin-bottom: 8px; color: #f3f4f6;">
            Estimated Round Times <span style="font-weight: normal; opacity: 0.8; font-size: 0.9em;">(${totalFrames} frames across ~${areaKm2} km²)</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; border-left: 2px solid #0d9488; padding-left: 10px;">`;

    if (components.lulc) msg += `<div style="display: flex; justify-content: space-between;"><span>• LULC Round:</span> <strong>~${2*lulcSec}s</strong></div>`;
    if (components.lst) msg += `<div style="display: flex; justify-content: space-between;"><span>• LST Round:</span> <strong>~${2*lstSec}s</strong></div>`;
    if (components.suhi) msg += `<div style="display: flex; justify-content: space-between;"><span>• SUHI Round:</span> <strong>~${suhiSec}s</strong></div>`;
    if (components.graphs) msg += `<div style="display: flex; justify-content: space-between;"><span>• Graphs Round:</span> <strong>~${graphsSec}s</strong></div>`;

    msg += `</div>
        <div style="background-color: rgba(13, 148, 136, 0.15); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(13, 148, 136, 0.3);">
            <span style="font-size: 0.95em; font-weight: 500;">Total Estimated Time:</span>
            <span style="font-size: 1.1em; color: #2dd4bf; font-weight: bold;">~${2*totalEstimatedSeconds}s</span>
        </div>
    </div>`;

    return { totalEstimatedSeconds, timeMessage: msg };
}

async function executeFullAnalysis() {
    const startYear = parseInt(document.getElementById('start-year')?.value || 2000, 10);
    const endYear = parseInt(document.getElementById('end-year')?.value || 2025, 10);
    const regionName = document.getElementById('select-region')?.value || 'Agra';
    const xCoord = parseFloat(document.getElementById('coord-x')?.value || 78.0081);
    const yCoord = parseFloat(document.getElementById('coord-y')?.value || 27.1767);
    
    const interval = document.getElementById('analysis-interval')?.value || 'yearly';
    
    // Retrieve monthly parameters if monthly analysis is selected
    let startMonth = null;
    let endMonth = null;
    if (interval === 'monthly') {
        startMonth = parseInt(document.getElementById('start-month')?.value || 1, 10);
        endMonth = parseInt(document.getElementById('end-month')?.value || 12, 10);
        
        if (startMonth > endMonth) {
            alert(`Start month cannot be later than End month.`);
            return;
        }
    }
                     
    const wantLulc = document.getElementById('chk-lulc')?.checked ?? false;
    const wantLst = document.getElementById('chk-lst')?.checked ?? false;
    const wantSuhi = document.getElementById('chk-suhi')?.checked ?? false;
    const wantGraphs = document.getElementById('chk-graphs')?.checked ?? false;

    const components = { lulc: wantLulc, lst: wantLst, suhi: wantSuhi, graphs: wantGraphs };

    if (!wantLulc && !wantLst && !wantSuhi && !wantGraphs) {
        alert("Please select at least one analysis component from the checkboxes.");
        return;
    }

    if (startYear > endYear) {
        alert(`Start year (${startYear}) cannot be greater than End year (${endYear}).`);
        return;
    }

    document.getElementById('section-lulc-wrapper')?.classList.toggle('hidden', !wantLulc);
    document.getElementById('section-lst-wrapper')?.classList.toggle('hidden', !wantLst);
    document.getElementById('section-suhi-wrapper')?.classList.toggle('hidden', !wantSuhi);
    document.getElementById('section-graphs-wrapper')?.classList.toggle('hidden', !wantGraphs);

    const payload = {
        roi_mode: currentMode,
        start_year: startYear,
        end_year: endYear,
        interval: interval,
        start_month: startMonth,
        end_month: endMonth,
        components: components,
        region_name: regionName,
        x: xCoord,
        y: yCoord,
        polygon_coords: currentRoiPolygon
    };

    // ... rest of your executeFullAnalysis function ...

    activeAnalysisController = new AbortController();
    const { signal } = activeAnalysisController;

    const steps = [];

    steps.push({ msg: "Initializing Region of Interest (ROI) and geometry boundaries...", action: async () => {
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
    }});

    steps.push({ msg: "Preparing analysis UI layout and clearing previous layers...", action: async () => {
        document.getElementById('lbl-built-1').innerText = `LULC CLASSIFICATION – ${startYear}`;
        document.getElementById('lbl-built-2').innerText = `LULC CLASSIFICATION – ${endYear}`;
        document.getElementById('lbl-lst-1').innerText = `LST HEATMAP – ${startYear}`;
        document.getElementById('lbl-lst-2').innerText = `LST HEATMAP – ${endYear}`;

        if (typeof clearAllAnalysisLayers === 'function') {
            clearAllAnalysisLayers();
        }
    }});

    // Conditional LULC Step
    if (wantLulc) {
        steps.push({ msg: "Running Land Use Land Cover (LULC) classification round...", action: async () => {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 300);
                signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
            });
        }});
    }

    // Conditional LST Step - Ensures LST is completely skipped if unchecked
    if (wantLst) {
        steps.push({ msg: "Computing Land Surface Temperature (LST) heatmaps round...", action: async () => {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 300);
                signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
            });
        }});
    }

    // Conditional SUHI Step
    if (wantSuhi) {
        steps.push({ msg: "Calculating Surface Urban Heat Island (SUHI) intensity round...", action: async () => {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 200);
                signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
            });
        }});
    }

    steps.push({ msg: "Executing backend query on Google Earth Engine for selected components...", action: async () => {
        const fetchPromise = fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: signal
        }).then(res => res.json());

        window._cachedAnalysisResult = await fetchPromise;
    }});

    if (wantGraphs) {
        steps.push({ msg: "Generating trends, scatter regression, and graph metrics...", action: async () => {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 200);
                signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
            });
        }});
    }

    steps.push({ msg: "Finalizing dashboard maps and UI display...", action: async () => {
        const result = window._cachedAnalysisResult;
        
        document.getElementById('roi-definition-section')?.classList.add('hidden');
        document.getElementById('analysis-results-section')?.classList.remove('hidden');

        if (wantGraphs && typeof switchChartTab === 'function') {
            switchChartTab('trend');
        }

        setTimeout(() => {
            [mapBuiltStart, mapBuiltEnd, mapLSTStart, mapLSTEnd].forEach(m => m && m.invalidateSize());
            if (wantLulc || wantLst) renderAnalysisLayers(result);
        }, 100);

        if (wantSuhi && typeof updateDashboardMetrics === 'function') {
            updateDashboardMetrics(result);
        }
        if (wantGraphs) {
            updateAnalyticsCharts(result);
        }

        if (typeof closeSidebar === 'function') {
            closeSidebar();
        }
    }});

    const totalSteps = steps.length;
    let currentStep = 0;

    const progressModal = document.getElementById('progress-modal');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressStepText = document.getElementById('progress-step-text');
    const minimizedWidget = document.getElementById('minimized-progress-widget');

    if (progressModal) {
        progressModal.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
    }
    if (minimizedWidget) {
        minimizedWidget.classList.add('hidden');
        minimizedWidget.classList.remove('flex');
    }

    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = `Analyzing ${regionName}...`;
    }

    try {
        for (let i = 0; i < steps.length; i++) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

            currentStep = i + 1;
            const percentage = Math.round((currentStep / totalSteps) * 100);

            if (progressStepText) progressStepText.innerText = steps[i].msg;
            if (progressPercentage) progressPercentage.innerText = `${percentage}%`;
            if (progressBarFill) progressBarFill.style.width = `${percentage}%`;

            await steps[i].action();
            
            if (typeof completeStep === 'function') {
                completeStep(currentStep, totalSteps, steps[i].msg);
            }
            
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        }

        setTimeout(() => {
            if (progressModal) progressModal.classList.add('hidden');
            if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.innerHTML = `<i data-lucide="trending-up" class="w-5 h-5"></i><span>Quantify SUHI & Growth</span>`;
                if (window.lucide) lucide.createIcons();
            }
        }, 400);

    } catch (err) {
        if (err.name === 'AbortError') {
            console.log("Analysis cancelled by user.");
        } else {
            console.error("Analysis error:", err);
            alert(`Analysis failed: ${err.message}`);
        }
        if (progressModal) progressModal.classList.add('hidden');
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

    if (trendChartInstance && data.trends) {
        trendChartInstance.data.labels = data.trends.labels || [];
        trendChartInstance.data.datasets[0].data = data.trends.suhi_series || [];
        trendChartInstance.data.datasets[1].data = data.trends.built_area_km2 || data.trends.builtup_series || [];
        trendChartInstance.update();
    }

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

        if (builtAreas.length > 0 && suhiSeries.length > 0) {
            const minX = Math.min(...builtAreas);
            const maxX = Math.max(...builtAreas);
            const minY = Math.min(...suhiSeries);
            const maxY = Math.max(...suhiSeries);

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

        setTimeout(() => {
            if (window.scatterChartInstance) {
                window.scatterChartInstance.resize();
                window.scatterChartInstance.update();
            }
        }, 50);
    }
}

function initAnalyticsCharts() {
    const ctxTrend = document.getElementById('suhiTrendChart')?.getContext('2d');
    if (ctxTrend) {
        if (window.trendChartInstance) {
            window.trendChartInstance.destroy();
        }

        window.trendChartInstance = new Chart(ctxTrend, {
            type: 'line',
            data: {
                labels: [],
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
                            maxTicksLimit: 12
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

    const ctxScatter = document.getElementById('suhiScatterChart')?.getContext('2d');
    if (ctxScatter) {
        if (window.scatterChartInstance) {
            window.scatterChartInstance.destroy();
        }

        window.scatterChartInstance = new Chart(ctxScatter, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Observations',
                        data: [],
                        type: 'scatter',
                        backgroundColor: '#38bdf8',
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: 'Linear Regression Trend',
                        data: [],
                        type: 'line',
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
                        type: 'linear',
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

    const cityName = document.getElementById('select-region')?.value || 'Custom_ROI';
    const interval = document.getElementById('analysis-interval')?.value || 'yearly';
    const downloadDate = new Date().toISOString().slice(0, 10);

    const opt = {
        margin: 0.3,
        filename: `SUHI_Report_${cityName}_${interval}_${downloadDate}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#020617' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
    };
    html2pdf().set(opt).from(element).save();
}

function calculatePolygonAreaKm2(coords) {
    if (!coords || !Array.isArray(coords) || coords.length < 3) return 0;

    let ring = coords;
    while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0][0])) {
        ring = ring[0];
    }

    const n = ring.length;
    if (n < 3) return 0;

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

    return Math.abs(area / 2.0) / 1e6;
}

function checkAoiAreaWarning(coords) {
    const banner = document.getElementById('aoi-warning-banner');
    const areaVal = document.getElementById('aoi-area-val');
    if (!banner) return;

    const areaKm2 = calculatePolygonAreaKm2(coords);
    if (areaVal) areaVal.textContent = Math.round(areaKm2);

    if (areaKm2 > 100) {
        banner.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    } else {
        banner.style.display = 'none';
    }
}

let activeFullscreenCardId = null;
let activeFullscreenMapInstance = null;

function toggleMapFullscreen(cardId, mapInstance) {
    const card = document.getElementById(cardId);
    if (!card) return;

    if (activeFullscreenCardId === cardId) {
        exitMapFullscreen();
        return;
    }

    if (activeFullscreenCardId) {
        exitMapFullscreen();
    }

    activeFullscreenCardId = cardId;
    activeFullscreenMapInstance = mapInstance;

    card.classList.add('map-card-fullscreen');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
        if (window.lucide) lucide.createIcons();
    }, 150);
}

function exitMapFullscreen() {
    if (!activeFullscreenCardId) return;

    const card = document.getElementById(activeFullscreenCardId);
    if (card) {
        card.classList.remove('map-card-fullscreen');
    }

    document.body.style.overflow = '';

    const mapInstance = activeFullscreenMapInstance;
    activeFullscreenCardId = null;
    activeFullscreenMapInstance = null;

    setTimeout(() => {
        if (mapInstance) {
            mapInstance.invalidateSize();
        }
    }, 150);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
        if (activeFullscreenCardId) {
            exitMapFullscreen();
        }
    }
});

function updateAnalyticsCharts(result) {
    const payload = result.data ? result.data : result;
    const trends = payload.trends;
    const stats = payload.statistics || payload.stats;

    if (!trends || !trends.labels || trends.labels.length === 0) {
        console.warn("[Chart Warning] No trends data in response:", result);
        return;
    }

    if (window.trendChartInstance) {
        window.trendChartInstance.data.labels = trends.labels;
        window.trendChartInstance.data.datasets[0].data = trends.suhi_series;
        window.trendChartInstance.data.datasets[1].data = trends.built_area_km2;

        window.trendChartInstance.resize();
        window.trendChartInstance.update();
    }

    if (window.scatterChartInstance && trends.built_area_km2 && trends.suhi_series) {
        const builtSeries = trends.built_area_km2;
        const suhiSeries = trends.suhi_series;

        const scatterPoints = builtSeries.map((area, idx) => ({
            x: Number(area),
            y: Number(suhiSeries[idx])
        }));

        let regressionPoints = [];

        if (trends.regression_line && trends.regression_line.length === builtSeries.length) {
            regressionPoints = builtSeries.map((xVal, idx) => ({
                x: Number(xVal),
                y: Number(trends.regression_line[idx])
            }));
        } else {
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
    }
}

function updateBufferedBoundsFromPolygon(coords) {
    if (!coords || coords.length === 0) {
        window.roiBufferedBounds = null;
        return;
    }
    const latLngs = coords.map(c => [c[1], c[0]]);
    const poly = L.polygon(latLngs);
    const bounds = poly.getBounds();
    
    const bufferDeg = 0.09; 
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    
    window.roiBufferedBounds = L.latLngBounds(
        L.latLng(southWest.lat - bufferDeg, southWest.lng - bufferDeg),
        L.latLng(northEast.lat + bufferDeg, northEast.lng + bufferDeg)
    );
}

function downloadMapCard(mapDivId, filenamePrefix, mapInstance) {
    const mapElement = document.getElementById(mapDivId);
    if (!mapElement) return;

    if (!mapInstance) {
        alert("Map instance not initialized.");
        return;
    }

    const cityName = document.getElementById('select-region')?.value || 'Custom_ROI';
    const interval = document.getElementById('analysis-interval')?.value || 'yearly';
    const downloadDate = new Date().toISOString().slice(0, 10);

    if (window.roiBufferedBounds) {
        mapInstance.fitBounds(window.roiBufferedBounds, { animate: false });
    } else {
        alert("Please define your study region first.");
        return;
    }

    mapInstance.invalidateSize();

    setTimeout(() => {
        html2canvas(mapElement, {
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#0f172a',
            scale: 2
        }).then(canvas => {
            const link = document.createElement('a');
            link.download = `${filenamePrefix}_${cityName}_${interval}_${downloadDate}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            console.error("Error generating map snapshot:", err);
            alert("Failed to download map image.");
        });
    }, 800);
}
// Updated switchView function for Dashboard and About Us tabs
function switchView(view) {
    const roiSection = document.getElementById('roi-definition-section');
    const resultsSection = document.getElementById('analysis-results-section');
    const aboutSection = document.getElementById('about-us-section');

    const navDashboard = document.getElementById('nav-dashboard');
    const navAbout = document.getElementById('nav-about');

    // Reset active nav styling on both items
    navDashboard?.classList.remove('active-nav', 'bg-slate-800', 'text-white');
    navAbout?.classList.remove('active-nav', 'bg-slate-800', 'text-white');

    if (view === 'about') {
        // Hide dashboard view components
        roiSection?.classList.add('hidden');
        resultsSection?.classList.add('hidden');
        
        // Show About Us component
        aboutSection?.classList.remove('hidden');
        
        // Highlight About tab
        navDashboard?.classList.remove('text-teal-400');
        navAbout?.classList.add('active-nav', 'bg-slate-800', 'text-white');
        
        // Close sidebar panel if open on mobile or if desired layout convention
        if (typeof closeSidebar === 'function') {
            closeSidebar();
        }
    } else {
        // Hide About Us component
        aboutSection?.classList.add('hidden');
        
        // Highlight Dashboard tab
        navDashboard?.classList.add('active-nav', 'bg-slate-800', 'text-white');

        // Check if analysis results are currently available
        const hasResults = window.trendChartInstance && window.trendChartInstance.data.labels.length > 0;
        if (hasResults) {
            resultsSection?.classList.remove('hidden');
            roiSection?.classList.add('hidden');
        } else {
            roiSection?.classList.remove('hidden');
            resultsSection?.classList.add('hidden');
        }

        // Open the sidebar choice window for region selection, parameters, and timeline workflow
        if (typeof openSidebar === 'function') {
            openSidebar();
        }

        // Fix Leaflet map sizing glitches after transition/layout visibility change
        setTimeout(() => {
            if (window.mapRoiPicker) window.mapRoiPicker.invalidateSize();
        }, 150);
    }

    // Refresh Lucide icons if dynamically modified
    if (window.lucide) {
        lucide.createIcons();
    }
}

function renderCharts(trends) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trends.labels,
            datasets: [
                {
                    label: 'SUHI Intensity (°C)',
                    data: trends.suhi_intensity,
                    borderColor: '#f97316',
                    backgroundColor: '#f97316',
                    yAxisID: 'y',
                    tension: 0.2
                },
                {
                    label: 'Built-up Area (km²)',
                    data: trends.built_up_area,
                    borderColor: '#14b8a6',
                    backgroundColor: '#14b8a6',
                    yAxisID: 'y1',
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    ticks: { color: '#f97316' }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#14b8a6' }
                }
            }
        }
    });
}

async function executeAnalysis() {
    const payload = {
        start_year: parseInt(document.getElementById('start-year').value),
        end_year: parseInt(document.getElementById('end-year').value),
        interval: document.getElementById('analysis-interval')?.value || 'yearly',
        polygon_coords: currentRoiPolygon,
        components: {
            lulc: document.getElementById('chk-lulc').checked,
            lst: document.getElementById('chk-lst').checked,
            suhi: document.getElementById('chk-suhi').checked,
            graphs: document.getElementById('chk-graphs').checked
        }
    };

    const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (result.success) {
        const graphsCard = document.getElementById('graphs-card');
        if (payload.components.graphs) {
            graphsCard.style.display = 'block';
            renderCharts(result.trends);
        } else {
            graphsCard.style.display = 'none';
        }
    }
}

// Track current coordinate input mode
let currentCoordType = 'single';

function setCoordInputType(type) {
    currentCoordType = type;
    document.getElementById('btn-coord-single')?.classList.toggle('bg-teal-600', type === 'single');
    document.getElementById('btn-coord-single')?.classList.toggle('text-white', type === 'single');
    document.getElementById('btn-coord-single')?.classList.toggle('text-slate-400', type !== 'single');

    document.getElementById('btn-coord-multiple')?.classList.toggle('bg-teal-600', type === 'multiple');
    document.getElementById('btn-coord-multiple')?.classList.toggle('text-white', type === 'multiple');
    document.getElementById('btn-coord-multiple')?.classList.toggle('text-slate-400', type !== 'multiple');

    document.getElementById('subpanel-coord-single')?.classList.toggle('hidden', type !== 'single');
    document.getElementById('subpanel-coord-multiple')?.classList.toggle('hidden', type !== 'multiple');

    if (type === 'multiple') {
        initDefaultMatrixPoints();
    }
    updateRoiFromCoordinates();
}

// Initialize default 4 points matrix for multiple point selection
function initDefaultMatrixPoints() {
    const container = document.getElementById('matrix-points-container');
    if (!container || container.children.length > 0) return;

    const defaultPoints = [
        { lat: 28.5000, lon: 77.1000 },
        { lat: 28.5000, lon: 77.3000 },
        { lat: 28.7000, lon: 77.3000 },
        { lat: 28.7000, lon: 77.1000 }
    ];

    container.innerHTML = '';
    defaultPoints.forEach((pt, index) => {
        appendVectorPointRow(pt.lat, pt.lon, index + 1);
    });
}

function appendVectorPointRow(lat = 28.0, lon = 77.0, index = null) {
    const container = document.getElementById('matrix-points-container');
    if (!container) return;

    const rowIdx = index || container.children.length + 1;
    const rowDiv = document.createElement('div');
    rowDiv.className = "grid grid-cols-12 gap-1.5 items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 vector-row";

    rowDiv.innerHTML = `
        <span class="col-span-2 text-[10px] font-bold text-teal-400 text-center">P${rowIdx}</span>
        <div class="col-span-4">
            <input type="number" step="0.0001" value="${lat}" class="sidebar-input vector-lat text-[11px] py-1" placeholder="Lat" oninput="updateRoiFromCoordinates()">
        </div>
        <div class="col-span-4">
            <input type="number" step="0.0001" value="${lon}" class="sidebar-input vector-lon text-[11px] py-1" placeholder="Lon" oninput="updateRoiFromCoordinates()">
        </div>
        <div class="col-span-2 flex justify-center">
            <button type="button" onclick="removeVectorPoint(event, this)" class="text-rose-400 hover:text-rose-300 p-1 text-xs transition" title="Remove Point">×</button>
        </div>
    `;
    container.appendChild(rowDiv);
}

function lockSidebarOpen() {
    const sidebar = document.getElementById('side-panel'); // Replace with your actual sidebar ID
    if (sidebar) {
        sidebar.classList.remove('collapsed', 'translate-x-full');
        sidebar.classList.add('expanded'); // Or whatever class keeps your panel open
    }
}

function removeVectorPoint(event, btn) {
    // Prevent any parent click handlers or form submissions from triggering
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const container = document.getElementById('matrix-points-container');
    if (!container) return;

    // Ensure minimum point threshold
    if (container.children.length <= 4) {
        alert("Minimum 4 points are required to form a closed polygon boundary.");
        return;
    }

    // Find and remove only the specific vector row
    const row = btn.closest('.vector-row');
    if (row) {
        row.remove();
    }

    // Recalculate coordinates/ROI without rebuilding or re-rendering the sidebar
    if (typeof updateRoiFromCoordinates === 'function') {
        updateRoiFromCoordinates();
    }
}

function addVectorPoint() {
    appendVectorPointRow(28.6000, 77.2000);
    updateRoiFromCoordinates();
}


function startAnalysis() {
    const modalOverlay = document.getElementById('progress-modal');
    if (!modalOverlay) return;

    modalOverlay.classList.remove('hidden');
    modalOverlay.classList.remove('opacity-0', 'pointer-events-none');

    console.log("Analysis initiated, progress window opened.");
}

let isModalMinimized = false;

function minimizeProgressModal() {
    isModalMinimized = true;
    const modalOverlay = document.getElementById('progress-modal');
    const minimizedWidget = document.getElementById('minimized-progress-widget');

    modalOverlay.classList.add('opacity-0', 'pointer-events-none');
    minimizedWidget.classList.remove('hidden');
    minimizedWidget.classList.add('flex');
}

function restoreProgressModal() {
    isModalMinimized = false;
    const modalOverlay = document.getElementById('progress-modal');
    const minimizedWidget = document.getElementById('minimized-progress-widget');

    modalOverlay.classList.remove('opacity-0', 'pointer-events-none');
    minimizedWidget.classList.add('hidden');
    minimizedWidget.classList.remove('flex');
}

function cancelProgressModal() {
    if (confirm("Are you sure you want to cancel the ongoing analysis?")) {
        // 1. Abort any ongoing fetch request and workflow steps
        if (activeAnalysisController) {
            activeAnalysisController.abort();
            activeAnalysisController = null;
        }

        const modalOverlay = document.getElementById('progress-modal');
        const minimizedWidget = document.getElementById('minimized-progress-widget');

        // 2. Hide modal and widget
        modalOverlay.classList.add('hidden');
        minimizedWidget.classList.add('hidden');

        // 3. Reset Analyze button state back to active
        const analyzeBtn = document.getElementById('analyze-btn');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<i data-lucide="trending-up" class="w-5 h-5"></i><span>Quantify SUHI & Growth</span>`;
            if (window.lucide) lucide.createIcons();
        }

        console.log("Analysis explicitly aborted and cancelled by user.");
    }
}

function handleRunAnalysis() {
    const lulc = document.getElementById('chk-lulc').checked;
    const lst = document.getElementById('chk-lst').checked;
    const suhi = document.getElementById('chk-suhi').checked;
    const graphs = document.getElementById('chk-graphs').checked;

    if (!lulc && !lst && !suhi && !graphs) {
        alert("Please select the result checkbox"); 
        return; 
    }

    console.log("Analysis running...");
}

function closeFramesPopup() {
    const modal = document.getElementById('frames-popup-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function showFramesPopup(message) {
    const modal = document.getElementById('frames-popup-modal');
    const msgElement = document.getElementById('frames-popup-message');
    if (msgElement) {
        msgElement.innerHTML = message;
    }
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function handleStartYearChange() {
    const startYearSelect = document.getElementById('start-year');
    const endYearSelect = document.getElementById('end-year');
    
    const selectedStartYear = parseInt(startYearSelect.value);
    const currentEndYear = parseInt(endYearSelect.value);

    // Loop through all options in the end year dropdown
    for (let option of endYearSelect.options) {
        if (!option.value) continue; // Skip the placeholder option

        const optionYear = parseInt(option.value);

        if (optionYear < selectedStartYear) {
            // Disable years less than the start year
            option.disabled = true;
            option.style.color = '#d1d5db'; // Optional: visual cue (grayed out)
        } else {
            // Enable valid years
            option.disabled = false;
            option.style.color = ''; // Reset color
        }
    }

    // If the currently selected end year is now invalid (less than start year), reset it
    if (currentEndYear && currentEndYear < selectedStartYear) {
        endYearSelect.value = "";
    }
}

// Accordion toggle function for About Us topics (auto-collapses others)
function toggleAboutAccordion(topicId) {
    const allTopics = ['topic-1', 'topic-2', 'topic-3'];
    
    allTopics.forEach(id => {
        const content = document.getElementById(`content-${id}`);
        const icon = document.getElementById(`icon-${id}`);
        
        if (id === topicId) {
            const isHidden = content.classList.contains('hidden');
            if (isHidden) {
                content.classList.remove('hidden');
                if (icon) icon.style.transform = 'rotate(180deg)';
            } else {
                content.classList.add('hidden');
                if (icon) icon.style.transform = 'rotate(0deg)';
            }
        } else {
            content?.classList.add('hidden');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    });
    if (window.lucide) lucide.createIcons();
}

// --- Shapefile Upload & Geometry Analysis State ---
let loadedShapefileGeoJSON = null;
let selectedShapefileFeatureIndex = 0;

// Update setRoiMode to support 'shapefile'
function setRoiMode(mode) {
    currentMode = mode;

    if (mode !== 'draw' && mode !== 'shapefile' && drawnItems) {
        drawnItems.clearLayers();
        currentRoiPolygon = null;
    }

    ['region', 'coordinates', 'draw', 'shapefile'].forEach(m => {
        document.getElementById(`btn-mode-${m}`)?.classList.toggle('active-roi-tab', m === mode);
        document.getElementById(`panel-${m}`)?.classList.toggle('hidden', m !== mode);
    });
}

// Handle Shapefile (.zip) or GeoJSON file upload
async function handleShapefileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const labelEl = document.getElementById('shapefile-upload-label');
    if (labelEl) labelEl.textContent = `Loaded: ${file.name}`;

    try {
        let geojson;
        const fileNameLower = file.name.toLowerCase();

        if (fileNameLower.endsWith('.zip')) {
            // Parse zipped Shapefile using shpjs[cite: 9]
            const arrayBuffer = await file.arrayBuffer();
            let parsed = await shp(arrayBuffer);
            
            if (Array.isArray(parsed)) {
                let allFeatures = [];
                parsed.forEach(fc => {
                    if (fc && fc.features) {
                        allFeatures = allFeatures.concat(fc.features);
                    }
                });
                geojson = { type: 'FeatureCollection', features: allFeatures };
            } else {
                geojson = parsed;
            }
        } else if (fileNameLower.endsWith('.kml')) {
            // Parse KML file using DOMParser and toGeoJSON
            const text = await file.text();
            const dom = new DOMParser().parseFromString(text, 'text/xml');
            
            // Check for XML parsing errors
            const parserError = dom.querySelector('parsererror');
            if (parserError) {
                throw new Error('Invalid KML XML structure.');
            }
            
            geojson = toGeoJSON.kml(dom);
        } else {
            // Parse standard GeoJSON / JSON[cite: 9]
            const arrayBuffer = await file.arrayBuffer();
            const textDecoder = new TextDecoder();
            const jsonString = textDecoder.decode(arrayBuffer);
            geojson = JSON.parse(jsonString);
        }

        // Normalize GeoJSON structures[cite: 9]
        if (geojson.type === 'Feature') {
            geojson = { type: 'FeatureCollection', features: [geojson] };
        } else if (geojson.type && geojson.type !== 'FeatureCollection') {
            geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
        }

        if (!geojson || !geojson.features || geojson.features.length === 0) {
            alert('No valid spatial features found in the uploaded file.');
            return;
        }

        loadedShapefileGeoJSON = geojson;
        populateShapefileFeatureSelector(geojson.features);

        document.getElementById('shapefile-analysis-subpanel')?.classList.remove('hidden');
        if (window.lucide) lucide.createIcons();

    } catch (err) {
        console.error('Error parsing spatial file:', err);
        alert('Failed to parse spatial file. Ensure your .zip contains valid .shp/.dbf files, or your .kml / .geojson file is correctly formatted.');
    }
}

// Populate the feature selector dropdown
function populateShapefileFeatureSelector(features) {
    const selectEl = document.getElementById('shapefile-feature-select');
    const countEl = document.getElementById('shapefile-feature-count');
    if (!selectEl) return;

    countEl.textContent = `${features.length} feature(s)`;
    selectEl.innerHTML = '<option value="" disabled selected>-- Select Geometry Feature --</option>';

    features.forEach((feat, idx) => {
        const props = feat.properties || {};
        
        // 1. Dynamically find ANY column key that contains "name" (case-insensitive)
        const nameKey = Object.keys(props).find(key => key.toLowerCase().includes('name'));

        // 2. Fallback check for other common identifier columns if no "name" column exists
        const fallbackKey = Object.keys(props).find(key => {
            const lowerKey = key.toLowerCase();
            return lowerKey.includes('district') || lowerKey.includes('id') || lowerKey.includes('code');
        });

        // 3. Extract the name using the found key, or fallback to "Feature #X"
        const name = (nameKey && props[nameKey]) || 
                    (fallbackKey && props[fallbackKey]) || 
                    `Feature #${idx + 1}`;

        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${idx + 1}. ${name}`;
        selectEl.appendChild(opt);
    });

    // Auto-select first feature by default
    if (features.length > 0) {
        selectEl.value = '0';
        onShapefileFeatureSelected(0);
    }
}

// Handle selection of a specific feature from the uploaded shapefile
function onShapefileFeatureSelected(indexStr) {
    const idx = parseInt(indexStr);
    if (isNaN(idx) || !loadedShapefileGeoJSON || !loadedShapefileGeoJSON.features[idx]) return;

    selectedShapefileFeatureIndex = idx;
    const feature = loadedShapefileGeoJSON.features[idx];
    const geomType = feature.geometry.type;

    document.getElementById('shp-info-type').textContent = geomType;

    // Render preview on map-roi-picker
    if (drawnItems) {
        drawnItems.clearLayers();
        const geoJsonLayer = L.geoJSON(feature, {
            style: { color: '#0d9488', fillColor: '#14b8a6', fillOpacity: 0.3, weight: 2 }
        });
        drawnItems.addLayer(geoJsonLayer);

        if (mapRoiPicker) {
            mapRoiPicker.fitBounds(geoJsonLayer.getBounds(), { padding: [30, 30] });
        }

        // Approximate area calculation in km² (rough bounding box estimation)
        const bounds = geoJsonLayer.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const approxArea = ((ne.lat - sw.lat) * 111) * ((ne.lng - sw.lng) * 111 * Math.cos((sw.lat + ne.lat) / 360 * Math.PI));
        document.getElementById('shp-info-area').textContent = `${Math.abs(approxArea).toFixed(2)} km²`;
    }
}

// Confirm and lock in the shapefile ROI geometry for analysis
function confirmShapefileRoiSelection() {
    if (!loadedShapefileGeoJSON || !loadedShapefileGeoJSON.features[selectedShapefileFeatureIndex]) {
        alert('Please select a valid spatial feature first.');
        return;
    }

    const feature = loadedShapefileGeoJSON.features[selectedShapefileFeatureIndex];
    let coords = [];

    // Extract coordinates into [lon, lat] boundary format
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
        coords = geom.coordinates[0].map(pt => [parseFloat(pt[0]), parseFloat(pt[1])]);
    } else if (geom.type === 'MultiPolygon') {
        coords = geom.coordinates[0][0].map(pt => [parseFloat(pt[0]), parseFloat(pt[1])]);
    } else {
        alert('Only Polygon and MultiPolygon geometries are supported for SUHI analysis.');
        return;
    }

    currentRoiPolygon = coords;
    if (typeof checkAoiAreaWarning === 'function') {
        checkAoiAreaWarning(currentRoiPolygon);
    }

    alert('Shapefile geometry successfully set as Region of Interest (ROI)! You can now proceed to run the analysis.');
}

function handleIntervalChange() {
    const intervalSelect = document.getElementById('analysis-interval');
    const monthlyContainer = document.getElementById('monthly-selector-container');
    if (!intervalSelect || !monthlyContainer) return;

    if (intervalSelect.value === 'monthly') {
        monthlyContainer.classList.remove('hidden');
    } else {
        monthlyContainer.classList.add('hidden');
    }
}

function logout() {
    localStorage.removeItem('active_session_user');
    fetch('/api/auth/logout', { method: 'POST' }).then(() => {
        window.location.href = '/login';
    });
}