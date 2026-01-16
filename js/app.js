const apiKeyDefault = ""; 
let addresses = [];
try { addresses = JSON.parse(localStorage.getItem('dpd_logs_v13') || '[]'); } catch(e) { addresses = []; }

let customers = [];
try { customers = JSON.parse(localStorage.getItem('dpd_customers') || '[]'); } catch(e) { customers = []; }

const config = JSON.parse(localStorage.getItem('dpd_config_v12') || JSON.stringify({
    name: "", stopWord: "notatka", theme: "auto", gpsEnabled: true, city: "", geminiKey: "", aiEnabled: true, geminiModel: "", aiProvider: "groq", wakeLockEnabled: false, carAssistantEnabled: false, voiceConfirmationEnabled: false, smartAssistantEnabled: false, proximityRadius: 40
}));

let myAreaStreets = [];
try { myAreaStreets = JSON.parse(localStorage.getItem('myAreaStreets') || '[]'); } catch(e) { myAreaStreets = []; }
let myAreaEditIndex = -1;

window.getMyAreaStreets = function() {
    return Array.isArray(myAreaStreets) ? myAreaStreets : [];
};

window.normalizeStreetName = function(address) {
    if (!address) return "";
    const text = String(address).trim();
    const match = text.match(/^(.+?)(\d)/);
    const street = match ? match[1] : text;
    return street.replace(/\s+/g, " ").trim().toUpperCase();
};

window.isAddressInMyArea = function(address) {
    const street = window.normalizeStreetName(address);
    if (!street) return false;
    const list = window.getMyAreaStreets();
    return list.indexOf(street) !== -1;
};

// System prompt dla AI
const aiSystemPrompt = `Jesteś asystentem kuriera DPD pracującego w Polsce. Otrzymujesz tekst podyktowany głosowo przez kuriera, który może zawierać błędy transkrypcji. Twoim zadaniem jest wyodrębnić z tego tekstu następujące informacje i zwrócić je w formacie JSON:

POLA WYJŚCIOWE:
- address: Adres dostawy/odbioru (nazwa ulicy + numer, np. "Andyjska 21a/5", "Himalajska 2a")
- type: Typ stopa - "delivery" (doręczenie) lub "pickup" (odbiór)
- note: Notatka z dodatkowymi informacjami (np. "zostawiona u sąsiada pod piątką", "pani jest bardzo miła")
- tip: Napiwek w złotych (liczba, np. 20 dla "20 złotych", 0 jeśli brak)

KRYTYCZNE ZASADY:
1. ZAWSZE zachowuj ukośniki w adresach - to jest BARDZO WAŻNE! (21f/3, 24b/23c, 15/17, 21f/13a, 21a/5)
2. Usuwaj TYLKO spacje wokół ukośników, NIE usuwaj samych ukośników (21 f / 3 -> 21f/3, NIE 21f3)
3. Napraw błędy transkrypcji mowy:
   - Liczby słowne na cyfry: "osiem naście" -> 18, "dwadzieścia jeden" -> 21, "pięć" -> 5
   - "przez", "na", "łamane" -> "/" (21a przez 3 -> 21a/3)
   - "f" może być rozpoznane jako "ef", "efek" itp. -> zawsze "f"
4. NIE zmieniaj nazw ulic - zachowaj oryginalną nazwę (Andyjska, Himalajska, Wiatraczna)
5. Formatuj adresy: pierwsza litera wielka, reszta mała (Andyjska 21a/5, Himalajska 2a)
6. WAŻNE: Adres może kończyć się literą lub cyfrą (np. 21f/13a, 21f/13, 2a). Pojedyncze litery po adresie (np. 'a', 'b', 'f') SĄ CZĘŚCIĄ ADRESU, NIE NOTATKI!
7. Typ stopa:
   - "delivery" (doręczenie) - domyślnie, chyba że wyraźnie wspomniano o odbiorze
   - "pickup" (odbiór) - tylko jeśli kurier mówi o "odbiorze", "odebraniu", "odbiorze paczki"
8. Notatka - wyodrębnij wszystkie dodatkowe informacje które NIE są adresem ani napiwkiem:
   - "zostawiona u sąsiada pod piątką" -> note: "zostawiona u sąsiada pod piątką"
   - "pani jest bardzo miła" -> note: "pani jest bardzo miła"
   - "paczka na piętrze" -> note: "paczka na piętrze"
9. Napiwek - wyodrębnij kwotę jeśli jest wspomniana:
   - "dostałem napiwek 20 złotych" -> tip: 20
   - "napiwek 15 zł" -> tip: 15
   - "20 zł napiwek" -> tip: 20
   - Jeśli brak wzmianki o napiwku -> tip: 0
10. Uwzględniaj niedoskonałości transkrypcji - tekst może być niepoprawnie rozpoznany, staraj się go zinterpretować w kontekście adresów polskich.

PRZYKŁADY:
- "Andyjska 21a przez 5 zostawiona u sąsiada pod piątką" -> {"address": "Andyjska 21a/5", "type": "delivery", "note": "zostawiona u sąsiada pod piątką", "tip": 0}
- "Himalajska 2a dostałem napiwek 20 złotych pani jest bardzo miła" -> {"address": "Himalajska 2a", "type": "delivery", "note": "pani jest bardzo miła", "tip": 20}
- "Wiatraczna 21f przez 13 odbiór" -> {"address": "Wiatraczna 21f/13", "type": "pickup", "note": "", "tip": 0}`;

let isRecording = false, isProcessingAI = false, lastTranscript = "", interimTranscript = "";
let wakeLock = null, currentView = 'list', map = null, markersGroup = null;
let customerMap = null, customerMarker = null;
let activeTipId = null, activeEditId = null, sunTimes = null;
let silenceTimeout = null; // Timeout dla automatycznego zatrzymania po braku mowy

// Cache geokodowania
let geocodeCache = {};
try { geocodeCache = JSON.parse(localStorage.getItem('geocode_cache_v1') || '{}'); } catch(e) { geocodeCache = {}; }

// Detekcja platformy - cross-platform compatibility
const platform = {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isAndroid: /Android/.test(navigator.userAgent),
    isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    isDesktop: !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    hasWakeLock: 'wakeLock' in navigator,
    hasVibration: 'vibrate' in navigator,
    hasGeolocation: 'geolocation' in navigator,
    hasSpeechRecognition: !!(window.webkitSpeechRecognition || window.SpeechRecognition),
    hasPermissionsAPI: 'permissions' in navigator,
    isHTTPS: location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1',
    isFileProtocol: location.protocol === 'file:'
};

// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Safe vibration - działa tylko na urządzeniach z wibracją
function safeVibrate(pattern) {
    if (platform.hasVibration && platform.isMobile) {
        try {
            navigator.vibrate(pattern);
        } catch(e) {
            // Ignoruj błędy wibracji
        }
    }
}

function getTodayStr() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// --- MODALE & AKCJE ---
window.handleConfirmAction = function(type, id = null) {
    const modal = document.getElementById('confirmModal');
    const text = document.getElementById('confirmModalText');
    const btn = document.getElementById('confirmBtnAction');
    if (type === 'delete_stop') {
        text.textContent = "Usunąć ten adres z listy?";
        btn.onclick = () => { window.deleteAddress(id); window.closeConfirmModal(); };
    } else if (type === 'reset_day') {
        text.textContent = "Wyczyścić dzisiejszą listę stopów?";
        btn.onclick = () => { window.confirmReset(); window.closeConfirmModal(); };
    } else if (type === 'clear_all') {
        text.textContent = "UWAGA! To usunie CAŁĄ historię. Kontynuować?";
        btn.onclick = () => { window.confirmAllClear(); window.closeConfirmModal(); };
    }
    modal.classList.add('modal-active');
};

window.closeConfirmModal = () => document.getElementById('confirmModal').classList.remove('modal-active');

window.openEditModal = function(id) {
    activeEditId = id;
    const item = addresses.find(a => a.id === id);
    if (item) {
        document.getElementById('editAddrInput').value = item.address;
        document.getElementById('editNoteInput').value = item.note || "";
        document.getElementById('editModal').classList.add('modal-active');
        setTimeout(() => document.getElementById('editAddrInput').focus(), 100);
    }
};

window.closeEditModal = () => document.getElementById('editModal').classList.remove('modal-active');

window.saveEdit = function() {
    const idx = addresses.findIndex(a => a.id === activeEditId);
    if (idx !== -1) {
        const oldAddr = addresses[idx].address;
        const newAddr = document.getElementById('editAddrInput').value.trim();
        if (!newAddr || newAddr.length < 2) {
            window.showToast("Adres jest zbyt krótki", "alert-circle", "text-red-500");
            return;
        }
        addresses[idx].address = newAddr;
        addresses[idx].note = document.getElementById('editNoteInput').value.trim();
        // Jeśli adres się zmienił, wyczyść współrzędne i geokoduj ponownie
        if (oldAddr !== newAddr) {
            addresses[idx].lat = null;
            addresses[idx].lng = null;
            if (config.gpsEnabled) {
                window.geocodeAddress(newAddr).then(coords => {
                    if (coords) {
                        addresses[idx].lat = coords.lat;
                        addresses[idx].lng = coords.lng;
                        localStorage.setItem('dpd_logs_v13', JSON.stringify(addresses));
                        if (currentView === 'map') window.renderMarkers();
                    }
                });
            }
        }
        window.saveAndRender();
        window.showToast("Zaktualizowano", "pencil", "text-blue-500");
    }
    window.closeEditModal();
};

// --- CUSTOMER DATABASE ---

window.addNewCustomer = function() {
    window.openCustomerModal(null);
};

window.openCustomerModal = function(addressOrId) {
    let customer = null;
    let address = "";
    let isNewManual = false;
    
    if (addressOrId === null) {
        isNewManual = true;
    } else if (typeof addressOrId === 'string') {
        // Mode: Add/Edit from Stop
        address = addressOrId;
        customer = customers.find(c => c.address === address);
    } else {
        // Mode: Edit from List
        customer = customers.find(c => c.id === addressOrId);
        if (customer) address = customer.address;
    }

    const addrInput = document.getElementById('custAddress');
    addrInput.value = address;
    const cityInput = document.getElementById('custCity');
    const defaultCity = (customer && customer.city) ? customer.city : (config.city || "");
    if (cityInput) cityInput.value = defaultCity;
    
    // Handle Readonly State
    if (isNewManual) {
        addrInput.removeAttribute('readonly');
        addrInput.classList.remove('opacity-60');
        addrInput.placeholder = "Wpisz adres...";
        document.getElementById('customerModalTitle').textContent = "Nowy Klient";
    } else {
        addrInput.setAttribute('readonly', 'true');
        addrInput.classList.add('opacity-60');
        document.getElementById('customerModalTitle').textContent = customer ? "Edycja Klienta" : "Dodaj Klienta";
    }

    document.getElementById('custName').value = customer ? customer.name : "";
    document.getElementById('custPhone').value = customer ? customer.phone : "";
    document.getElementById('custNote').value = customer ? customer.static_note : "";
    
    // Setup Call Button
    const callBtn = document.getElementById('custPhoneCall');
    if (customer && customer.phone) {
        callBtn.href = `tel:${customer.phone}`;
        callBtn.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        callBtn.href = "#";
        callBtn.classList.add('opacity-50', 'pointer-events-none');
    }

    // Setup Delete Button
    const delBtn = document.getElementById('btnDeleteCustomer');
    if (customer) {
        delBtn.classList.remove('hidden');
        delBtn.onclick = () => window.deleteCustomer(customer.id);
    } else {
        delBtn.classList.add('hidden');
    }

    const modal = document.getElementById('customerModal');
    modal.setAttribute('data-mode', customer ? 'edit' : 'add');
    modal.classList.add('modal-active');
    setTimeout(() => {
        if (isNewManual) {
            addrInput.focus();
        } else {
            document.getElementById('custName').focus();
        }
        
        // Initialize Map
        if (!customerMap) {
            customerMap = L.map('customerMap', { zoomControl: false }).setView([52.23, 21.01], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(customerMap);
        }
        
        customerMap.invalidateSize();
        
        if (customerMarker) {
            customerMap.removeLayer(customerMarker);
            customerMarker = null;
        }
        
        if (customer && customer.lat && customer.lng) {
            const latLng = [customer.lat, customer.lng];
            customerMap.setView(latLng, 16);
            customerMarker = L.marker(latLng, { draggable: true }).addTo(customerMap);
        } else {
            // Default view or geocode
            if (address && config.gpsEnabled) {
                // Try to simple geocode or use city center
                // For now, center on current map view or city
                if (map) customerMap.setView(map.getCenter(), 14);
                else customerMap.setView([52.23, 21.01], 13);
                
                // Try to geocode address
                window.geocodeAddress(address).then(coords => {
                    if (coords) {
                        customerMap.setView([coords.lat, coords.lng], 16);
                        if (customerMarker) customerMap.removeLayer(customerMarker);
                        customerMarker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(customerMap);
                    }
                });
            } else {
                 if (map) customerMap.setView(map.getCenter(), 13);
            }
        }
    }, 100);
};

window.closeCustomerModal = () => document.getElementById('customerModal').classList.remove('modal-active');

window.saveCustomer = async function() {
    const address = document.getElementById('custAddress').value;
    const city = document.getElementById('custCity').value.trim() || (config.city || "");
    const name = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const note = document.getElementById('custNote').value.trim();

    if (!address) {
        window.showToast("Podaj adres klienta", "alert-circle", "text-red-500");
        return;
    }

    if (!name) {
        window.showToast("Podaj nazwę klienta", "alert-circle", "text-red-500");
        return;
    }

    const existingIdx = customers.findIndex(c => c.address === address);
    
    // Validation: Uniqueness check
    const modal = document.getElementById('customerModal');
    const mode = modal.getAttribute('data-mode');
    
    // Jeśli tryb 'add' (nowy klient) i adres już istnieje -> Błąd
    if (mode === 'add' && existingIdx !== -1) {
        window.showToast("Klient o tym adresie już istnieje!", "alert-circle", "text-red-500");
        return;
    }
    const newCustomer = {
        id: existingIdx !== -1 ? customers[existingIdx].id : Date.now(),
        address: address,
        city: city,
        name: name,
        phone: phone,
        static_note: note
    };

    // Save coordinates if marker exists
    if (customerMarker) {
        const pos = customerMarker.getLatLng();
        newCustomer.lat = pos.lat;
        newCustomer.lng = pos.lng;
    } else if (address) {
        // Try to geocode if no marker set (fallback)
        try {
             window.showToast("Geokodowanie...", "map-pin", "text-blue-500");
             const coords = await window.geocodeAddress(address, city);
             if (coords) {
                 newCustomer.lat = coords.lat;
                 newCustomer.lng = coords.lng;
             }
        } catch(e) {
            console.error("Geocoding failed during save:", e);
        }
    }

    if (existingIdx !== -1) {
        customers[existingIdx] = newCustomer;
        window.showToast("Zaktualizowano klienta", "user-check", "text-blue-500");
    } else {
        customers.push(newCustomer);
        window.showToast("Dodano klienta", "user-plus", "text-green-500");
    }

    localStorage.setItem('dpd_customers', JSON.stringify(customers));
    window.closeCustomerModal();
    window.saveAndRender(); // Odśwież listę stopów
    if (currentView === 'customers') window.renderCustomersList(); // Odśwież listę zarządzania
};

window.deleteCustomer = function(id) {
    if (confirm("Usunąć tego klienta z bazy?")) {
        customers = customers.filter(c => c.id !== id);
        localStorage.setItem('dpd_customers', JSON.stringify(customers));
        window.closeCustomerModal();
        window.saveAndRender();
        if (currentView === 'customers') window.renderCustomersList();
        window.showToast("Usunięto klienta", "trash", "text-red-500");
    }
};

window.deleteCustomerCurrent = function() {
    const address = document.getElementById('custAddress').value;
    const customer = customers.find(c => c.address === address);
    if (customer) window.deleteCustomer(customer.id);
};

window.renderCustomersList = function() {
    const listEl = document.getElementById('customersList');
    const search = document.getElementById('customerSearch').value.toLowerCase();
    
    const filtered = customers.filter(c => 
        c.name.toLowerCase().includes(search) || 
        c.address.toLowerCase().includes(search) ||
        (c.phone && c.phone.includes(search))
    );

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="text-center py-10 opacity-50"><p>Brak klientów</p></div>`;
        return;
    }

    // Group by street
    const groups = {};
    filtered.forEach(c => {
        let street = c.address.replace(/\d+.*$/, '').trim();
        if (!street) street = "Inne";
        street = street.charAt(0).toUpperCase() + street.slice(1);
        
        if (!groups[street]) groups[street] = [];
        groups[street].push(c);
    });
    
    const sortedStreets = Object.keys(groups).sort();

    listEl.innerHTML = sortedStreets.map(street => {
        const count = groups[street].length;
        const customersHtml = groups[street].map(c => `
            <div class="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm flex justify-between items-center mb-2 last:mb-0 gap-3">
                <div class="flex-1 min-w-0 text-left">
                     <p class="font-bold text-sm truncate">${c.address}</p>
                    <p class="text-xs font-medium text-gray-500 truncate">${c.name}</p>
                </div>
                <div class="flex items-center gap-2">
                    ${c.phone ? `
                        <a href="tel:${c.phone}" class="flex-none w-10 h-10 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded-xl shadow-sm transition-colors">
                            <i data-lucide="phone" class="w-5 h-5"></i>
                        </a>
                    ` : ''}
                    <button onclick="window.openCustomerModal(${c.id})" class="p-2 bg-gray-50 dark:bg-zinc-800 rounded-full shadow-sm">
                        <i data-lucide="pencil" class="w-4 h-4 text-gray-400"></i>
                    </button>
                </div>
            </div>
        `).join('');

        return `
        <div class="bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden mb-3">
            <button onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.chevron-icon').classList.toggle('rotate-180')" class="w-full p-4 flex justify-between items-center hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
                <h3 class="text-sm font-black uppercase text-dpd-red flex items-center gap-2 text-left">
                    ${street} 
                    <span class="bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-gray-300 text-[10px] px-1.5 py-0.5 rounded-full">${count}</span>
                </h3>
                <i data-lucide="chevron-down" class="w-5 h-5 text-gray-400 transition-transform chevron-icon"></i>
            </button>
            <div class="hidden p-4 pt-0 space-y-2 border-t border-gray-100 dark:border-zinc-800/50">
                ${customersHtml}
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
};

// --- WAKE LOCK ---
// Old implementation removed - see WakeLockManager below


// --- UI & PARSOWANIE ---
window.setAIStatusUI = function() {
    const dot = document.getElementById('aiDot');
    const label = document.getElementById('aiStatusLabel');
    if (dot && label) {
        if (!config.aiEnabled) {
            dot.className = "w-1.5 h-1.5 bg-gray-500 rounded-full transition-colors";
            label.textContent = "AI: WYŁ";
        } else if (!config.geminiKey || config.geminiKey.trim().length === 0) {
            dot.className = "w-1.5 h-1.5 bg-yellow-500 rounded-full transition-colors";
            label.textContent = "AI: BRAK KLUCZA";
        } else if (isProcessingAI) {
            dot.className = "w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse transition-colors";
            label.textContent = "AI: ANALIZA";
        } else {
            dot.className = "w-1.5 h-1.5 bg-green-500 rounded-full transition-colors";
            label.textContent = "AI: OK";
        }
    }
};

window.setChargingStatusUI = function(state) {
    const dot = document.getElementById('chargeDot');
    const label = document.getElementById('chargeText');
    if (!dot || !label) return;
    if (state === 'on') {
        dot.className = "w-1.5 h-1.5 bg-green-500 rounded-full transition-colors";
        label.textContent = "Ładowanie: ON";
    } else if (state === 'off') {
        dot.className = "w-1.5 h-1.5 bg-red-500 rounded-full transition-colors";
        label.textContent = "Ładowanie: OFF";
    } else {
        dot.className = "w-1.5 h-1.5 bg-gray-500 rounded-full transition-colors";
        label.textContent = "Ładowanie: BRAK DANYCH";
    }
};

window.initChargingIndicator = function() {
    window.setChargingStatusUI('unknown');
    if (!('getBattery' in navigator)) return;
    navigator.getBattery().then(battery => {
        const update = () => {
            if (typeof battery.charging === 'boolean') {
                window.setChargingStatusUI(battery.charging ? 'on' : 'off');
            } else {
                window.setChargingStatusUI('unknown');
            }
        };
        update();
        if (typeof battery.addEventListener === 'function') {
            battery.addEventListener('chargingchange', update);
        } else if ('onchargingchange' in battery) {
            battery.onchargingchange = update;
        }
    }).catch(e => {
        console.log('Battery indicator error:', e);
        window.setChargingStatusUI('unknown');
    });
};

window.setUIProcessing = function(proc) {
    isProcessingAI = proc;
    const b = document.getElementById('micBtn');
    const l = document.getElementById('micLabel');
    if (proc) { b?.classList.add('pulse-ai'); if (l) { l.textContent = "Analiza..."; l.style.opacity = '1'; } }
    else { b?.classList.remove('pulse-ai'); if (l) { l.textContent = "Słucham..."; l.style.opacity = '0'; } }
    window.setAIStatusUI();
};

window.showToast = function(m, i, c) {
    const t = document.getElementById('toast');
    const text = document.getElementById('toastText');
    const icon = document.getElementById('toastIcon');
    if (!t || !text || !icon) return;
    text.textContent = m;
    icon.setAttribute('data-lucide', i);
    icon.className = `w-4 h-4 ${c}`;
    lucide.createIcons();
    t.style.opacity = '1';
    setTimeout(() => t.style.opacity = '0', 2500);
};

window.updateCityFromGps = function() {
    if (!platform.hasGeolocation) {
        window.showToast("GPS nie jest dostępny", "map-pin-off", "text-red-500");
        return;
    }
    window.showToast("Pobieram miasto...", "map-pin", "text-blue-500");
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&zoom=10`);
            const data = await res.json();
            const city = data.address.city || data.address.town || data.address.village;
            if (city) {
                config.city = city;
                document.getElementById('setCity').value = city;
                localStorage.setItem('dpd_config_v12', JSON.stringify(config));
                window.showToast(`Ustawiono: ${city}`, "check", "text-green-500");
                sunTimes = null; window.refreshTheme();
            }
        } catch(e) { 
            console.error('GPS error:', e);
            window.showToast("Błąd pobierania miasta", "x", "text-red-500"); 
        }
    }, (err) => {
        console.error('Geolocation error:', err);
        if (err.code === 1) {
            window.showToast("Brak uprawnień do lokalizacji", "map-pin-off", "text-red-500");
        } else if (err.code === 2) {
            window.showToast("Nie można określić lokalizacji", "map-pin-off", "text-red-500");
        } else {
            window.showToast("Błąd GPS", "x", "text-red-500");
        }
    }, {
        timeout: 10000,
        enableHighAccuracy: platform.isMobile, // Tylko na mobile używaj wysokiej dokładności
        maximumAge: 300000 // Cache 5 minut
    });
};

let citySuggestionItems = [];

window.renderCitySuggestions = function(items) {
    const box = document.getElementById('setCitySuggestions');
    if (!box) return;
    citySuggestionItems = items || [];
    if (!items || items.length === 0) {
        box.innerHTML = "";
        box.classList.add('hidden');
        return;
    }
    box.innerHTML = items.map((item, idx) => {
        const addr = item.address || {};
        const cityName = addr.city || addr.town || addr.village || (item.display_name || '').split(',')[0];
        const region = addr.state || addr.county || "";
        const display = region ? `${cityName} (${region})` : cityName;
        return `<button type="button" data-idx="${idx}" class="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-100 dark:hover:bg-zinc-800 flex items-center gap-2">
                    <span class="font-bold">${cityName}</span>
                    <span class="text-[10px] opacity-70 truncate">${region}</span>
                </button>`;
    }).join('');
    box.classList.remove('hidden');
};

window.searchCitySuggestions = async function(query) {
    query = (query || '').trim();
    if (!query || query.length < 2) {
        window.renderCitySuggestions([]);
        return;
    }
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=pl&featuretype=settlement&limit=8&q=${encodeURIComponent(query)}&accept-language=pl`;
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!res.ok) {
            window.renderCitySuggestions([]);
            return;
        }
        const data = await res.json();
        window.renderCitySuggestions(Array.isArray(data) ? data : []);
    } catch (e) {
        console.error('City autocomplete error:', e);
        window.renderCitySuggestions([]);
    }
};

window.initCityAutocomplete = function() {
    const input = document.getElementById('setCity');
    const box = document.getElementById('setCitySuggestions');
    if (!input || !box) return;
    const debouncedSearch = debounce((val) => window.searchCitySuggestions(val), 300);
    input.addEventListener('input', () => {
        const val = input.value.trim();
        if (val.length < 2) {
            window.renderCitySuggestions([]);
            return;
        }
        debouncedSearch(val);
    });
    input.addEventListener('blur', () => {
        setTimeout(() => window.renderCitySuggestions([]), 200);
    });
    box.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('button[data-idx]');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const item = citySuggestionItems[idx];
        if (!item) return;
        const addr = item.address || {};
        const cityName = addr.city || addr.town || addr.village || (item.display_name || '').split(',')[0];
        if (!cityName) return;
        input.value = cityName;
        config.city = cityName;
        localStorage.setItem('dpd_config_v12', JSON.stringify(config));
        window.renderCitySuggestions([]);
        sunTimes = null;
        window.refreshTheme();
    });
};

window.renderMyAreaStreets = function() {
    const container = document.getElementById('myAreaList');
    if (!container) return;
    if (!myAreaStreets || myAreaStreets.length === 0) {
        container.innerHTML = "";
        return;
    }
    container.innerHTML = myAreaStreets.map((name, idx) => {
        return `<div class="w-full inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/20 text-dpd-red dark:text-red-300 px-3 py-1 rounded-full text-[11px] font-bold">
                    <span class="truncate flex-1">${name}</span>
                    <button type="button" onclick="window.editMyAreaStreet(${idx})" class="p-0.5 opacity-70 hover:opacity-100">
                        <i data-lucide="pencil" class="w-3 h-3"></i>
                    </button>
                    <button type="button" onclick="window.deleteMyAreaStreet(${idx})" class="p-0.5 opacity-70 hover:opacity-100">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
};

window.addMyAreaStreet = function() {
    const input = document.getElementById('myAreaInput');
    const btn = document.getElementById('myAreaAddBtn');
    if (!input) return;
    const raw = input.value || "";
    let value = raw.replace(/\s+/g, " ").trim();
    if (!value) return;
    const normalized = value.toUpperCase();
    const list = window.getMyAreaStreets();
    if (list.indexOf(normalized) !== -1 && myAreaEditIndex === -1) {
        window.showToast("Ta ulica jest już na liście", "alert-circle", "text-yellow-500");
        return;
    }
    if (myAreaEditIndex >= 0 && myAreaEditIndex < myAreaStreets.length) {
        myAreaStreets[myAreaEditIndex] = normalized;
    } else {
        myAreaStreets.push(normalized);
    }
    localStorage.setItem('myAreaStreets', JSON.stringify(myAreaStreets));
    input.value = "";
    myAreaEditIndex = -1;
    if (btn) btn.textContent = "Dodaj";
    window.renderMyAreaStreets();
};

window.editMyAreaStreet = function(index) {
    const input = document.getElementById('myAreaInput');
    const btn = document.getElementById('myAreaAddBtn');
    if (!input) return;
    if (index < 0 || index >= myAreaStreets.length) return;
    input.value = myAreaStreets[index];
    myAreaEditIndex = index;
    if (btn) btn.textContent = "Zapisz";
    input.focus();
    try {
        const len = input.value.length;
        input.setSelectionRange(len, len);
    } catch(e) {}
};

window.deleteMyAreaStreet = function(index) {
    const btn = document.getElementById('myAreaAddBtn');
    const input = document.getElementById('myAreaInput');
    if (index < 0 || index >= myAreaStreets.length) return;
    myAreaStreets.splice(index, 1);
    localStorage.setItem('myAreaStreets', JSON.stringify(myAreaStreets));
    if (myAreaEditIndex === index) {
        myAreaEditIndex = -1;
        if (btn) btn.textContent = "Dodaj";
        if (input) input.value = "";
    } else if (myAreaEditIndex > index) {
        myAreaEditIndex -= 1;
    }
    window.renderMyAreaStreets();
};

window.geocodeAddress = async function(addr, customCity) {
    const search = addr.split('/')[0].trim();
    if (!search) return null;
    
    // Sprawdź cache
    const city = (customCity || config.city || '').trim();
    const cacheKey = `${search.toLowerCase()}_${city.toLowerCase()}`;
    if (geocodeCache[cacheKey]) {
        return geocodeCache[cacheKey];
    }
    
    // Wyodrębnij numer z adresu (np. "Andyjska 21a" -> "21a", "Himalajska 2a" -> "2a", "Wiatraczna 28" -> "28")
    const addressMatch = search.match(/(.+?)\s+(\d+[a-z]?)$/i);
    let streetName = search;
    let houseNumber = null;
    
    if (addressMatch) {
        streetName = addressMatch[1].trim();
        houseNumber = addressMatch[2].trim();
    }
    
    let q = encodeURIComponent(search);
    if (city) q += encodeURIComponent(`, ${city}`);
    
    try {
        // Rate limiting - Nominatim wymaga max 1 req/s
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Pobierz więcej wyników aby móc znaleźć najbliższy numer
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=10`);
        const data = await res.json();
        
        let result = null;
        
        if (data && data.length > 0) {
            // Jeśli mamy numer domu, spróbuj znaleźć dokładny lub najbliższy
            if (houseNumber) {
                // Najpierw spróbuj znaleźć dokładny numer
                const exactMatch = data.find(r => {
                    const displayName = (r.display_name || '').toLowerCase();
                    const searchLower = search.toLowerCase();
                    return displayName.includes(searchLower);
                });
                
                if (exactMatch) {
                    result = { lat: parseFloat(exactMatch.lat), lng: parseFloat(exactMatch.lon) };
                } else {
                    // Nie znaleziono dokładnego numeru - szukaj najbliższego
                    // Wyodrębnij numer z houseNumber (np. "21a" -> 21, "2a" -> 2, "28" -> 28)
                    const numMatch = houseNumber.match(/(\d+)/);
                    if (numMatch) {
                        const targetNum = parseInt(numMatch[1]);
                        
                        // Szukaj w wynikach numerów na tej samej ulicy
                        const streetResults = data.filter(r => {
                            const displayName = (r.display_name || '').toLowerCase();
                            return displayName.includes(streetName.toLowerCase());
                        });
                        
                        if (streetResults.length > 0) {
                            // Znajdź najbliższy numer
                            let closest = null;
                            let minDiff = Infinity;
                            
                            streetResults.forEach(r => {
                                // Wyodrębnij numer z display_name (szukaj wzorca "ulica numer")
                                const addrParts = (r.display_name || '').split(',');
                                const firstPart = addrParts[0] || '';
                                const numMatch = firstPart.match(/(\d+)/);
                                if (numMatch) {
                                    const num = parseInt(numMatch[1]);
                                    const diff = Math.abs(num - targetNum);
                                    if (diff < minDiff) {
                                        minDiff = diff;
                                        closest = r;
                                    }
                                }
                            });
                            
                            if (closest) {
                                result = { lat: parseFloat(closest.lat), lng: parseFloat(closest.lon) };
                            } else {
                                // Użyj pierwszego wyniku z ulicy
                                result = { lat: parseFloat(streetResults[0].lat), lng: parseFloat(streetResults[0].lon) };
                            }
                        } else {
                            // Brak wyników z ulicy - użyj pierwszego wyniku
                            result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                        }
                    } else {
                        // Użyj pierwszego wyniku
                        result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                    }
                }
            } else {
                // Brak numeru - użyj pierwszego wyniku
                result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            }
        }
        
        // Zapisz w cache (max 1000 wpisów)
        if (result) {
            const keys = Object.keys(geocodeCache);
            if (keys.length >= 1000) {
                // Usuń najstarsze 100 wpisów
                const oldest = keys.slice(0, 100);
                oldest.forEach(k => delete geocodeCache[k]);
            }
            geocodeCache[cacheKey] = result;
            localStorage.setItem('geocode_cache_v1', JSON.stringify(geocodeCache));
        }
        return result;
    } catch(e) { 
        console.error('Geocoding error:', e);
        return null; 
    }
};

window.refreshTheme = async function() {
    let target = config.theme;
    if (config.theme === 'auto') {
        const now = new Date();
        if (!sunTimes && config.city) {
            const coords = await window.geocodeAddress(config.city);
            if (coords) {
                const res = await fetch(`https://api.sunrise-sunset.org/json?lat=${coords.lat}&lng=${coords.lng}&formatted=0`);
                const data = await res.json();
                if (data.status === "OK") sunTimes = { sunrise: new Date(data.results.sunrise), sunset: new Date(data.results.sunset) };
            }
        }
        if (sunTimes) target = (now >= sunTimes.sunrise && now < sunTimes.sunset) ? 'light' : 'dark';
        else target = (now.getHours() >= 7 && now.getHours() < 19) ? 'light' : 'dark';
    }
    document.documentElement.classList.toggle('dark', target === 'dark');
    const icon = document.getElementById('themeQuickIcon');
    if (icon) icon.setAttribute('data-lucide', target === 'dark' ? 'moon' : 'sun');
    const autoLabel = document.getElementById('themeAutoLabel');
    if (autoLabel) autoLabel.classList.toggle('hidden', config.theme !== 'auto');
    lucide.createIcons();
};

window.cycleThemeManual = function() {
    const modes = ['light', 'dark', 'auto'];
    config.theme = modes[(modes.indexOf(config.theme) + 1) % 3];
    document.getElementById('setTheme').value = config.theme;
    window.applySettings();
};

window.formatPolishNumbers = function(text) {
    if (!text) return '';
    let t = text.trim();
    if (platform && platform.isIOS) {
        const iosTeenMap = {
            'jeden naście': '11',
            'jedna naście': '11',
            'jedno naście': '11',
            'dwie naście': '12',
            'dwa naście': '12',
            'trzy naście': '13',
            'cztery naście': '14',
            'pięć naście': '15',
            'sześć naście': '16',
            'siedem naście': '17',
            'osiem naście': '18',
            'dziewięć naście': '19'
        };
        Object.keys(iosTeenMap).forEach(phrase => {
            const regexTeen = new RegExp(`\\b${phrase}\\b`, 'gi');
            t = t.replace(regexTeen, iosTeenMap[phrase]);
        });
        const iosSimpleMap = {
            'jeden': '1',
            'jedna': '1',
            'jedno': '1',
            'dwa': '2',
            'dwie': '2',
            'trzy': '3',
            'cztery': '4',
            'pięć': '5',
            'sześć': '6',
            'siedem': '7',
            'osiem': '8',
            'dziewięć': '9'
        };
        Object.keys(iosSimpleMap).forEach(w => {
            const regexSimple = new RegExp(`\\b${w}\\b`, 'gi');
            t = t.replace(regexSimple, iosSimpleMap[w]);
        });
    }
    
    // 1. Najpierw zachowaj oryginalną wielkość liter dla nazw ulic (pierwsza litera wielka)
    // Podziel na słowa, zachowując strukturę
    const words = t.split(/\s+/);
    
    // 2. Mapowanie liczb słownych na cyfry
    const numMap = { 'zero': '0', 'jeden': '1', 'dwa': '2', 'trzy': '3', 'cztery': '4', 'pięć': '5', 'sześć': '6', 'siedem': '7', 'osiem': '8', 'dziewięć': '9', 'dziesięć': '10' };
    Object.keys(numMap).forEach(w => {
        const regex = new RegExp(`\\b${w}\\b`, 'gi');
        t = t.replace(regex, numMap[w]);
    });
    
    // 3. Napraw liczby złożone (naście, dziesiąt)
    t = t.replace(/(\d+)\s+naście\b/gi, (m, g1) => (parseInt(g1) + 10).toString());
    t = t.replace(/(\d+)\s+dziesiąt\b/gi, (m, g1) => (parseInt(g1) * 10).toString());
    
    // 3.5. [iOS Fix] Sklejanie i normalizacja liter przy numerach PRZED obsługą "przez"
    if (platform && platform.isIOS) {
        const iosCharMap = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
        // Zamień polskie litery po cyfrach na łacińskie (np. "13 ą" -> "13a")
        t = t.replace(/(\d+)\s*([ąęćłńóśźżĄĘĆŁŃÓŚŹŻ])/gi, (m, n, c) => {
             return n + (iosCharMap[c.toLowerCase()] || c);
        });
    }
    // Sklej cyfry z literami (np. "131 b" -> "131b")
    t = t.replace(/(\d+)\s+([a-zA-Z])\b/gi, '$1$2');
    
    // 4. Najpierw zamień słowa "przez", "na", "łamane" na ukośniki
    // "21a przez 3" -> "21a/3", "21 na 3" -> "21/3"
    t = t.replace(/(\d+[a-z]?)\s+(przez|na|łamane|łamane\s+na)\s+(\d+[a-z]?)/gi, '$1/$3');
    
    // 5. Normalizuj różne warianty ukośników i spacji
    // "21 f / 3" -> "21f/3", "21 f/ 3" -> "21f/3", "21f /3" -> "21f/3"
    t = t.replace(/(\d+[a-z]?)\s*\/\s*(\d+[a-z]?)/gi, '$1/$2');
    
    // 6. Wykryj i napraw wzorce bez ukośników (gdy rozpoznawanie mowy nie rozpoznało ukośnika)
    // Wzorzec 1: "21a 3" -> "21a/3" (gdy pierwsza część już ma literę, a potem jest cyfra)
    // Używamy bardziej precyzyjnego wzorca - tylko gdy druga część to mała cyfra (1-9) lub cyfra z literą
    t = t.replace(/(\d+[a-z])\s+(\d{1,2}[a-z]?)\b/gi, (match, part1, part2) => {
        // Jeśli mamy "21a 3" lub "21a 3b", zamień na "21a/3" lub "21a/3b"
        // Ale tylko jeśli druga część to mała liczba (1-99) - żeby nie łączyć z dużymi numerami ulic
        const num2 = parseInt(part2);
        if (num2 >= 1 && num2 <= 99) {
            return `${part1}/${part2}`;
        }
        return match;
    });
    
    // Wzorzec 2: "21 f 3" -> "21f/3" (gdy pierwsza część to tylko cyfra, a litera jest osobno)
    t = t.replace(/(\d+)\s+([a-z])\s+(\d{1,2}[a-z]?)\b/gi, (match, num1, letter, num2) => {
        // Jeśli mamy "21 f 3", zamień na "21f/3"
        const num = parseInt(num2);
        if (/^[a-z]$/.test(letter) && num >= 1 && num <= 99) {
            return `${num1}${letter}/${num2}`;
        }
        return match;
    });
    
    // 6. Usuń spacje wokół ukośników (zachowaj ukośnik!)
    t = t.replace(/\s*\/\s*/g, '/');
    
    // 7. Połącz cyfry z literami (21 f -> 21f, ale NIE zmieniaj nazw ulic)
    // Tylko jeśli jest cyfra przed literą i NIE ma już ukośnika po literze
    t = t.replace(/(\d+)\s+([a-z])(?!\s*\/)/gi, '$1$2');
    
    // 7. Normalizuj wielokrotne spacje
    t = t.replace(/\s+/g, ' ');
    
    // 8. Przywróć wielką literę na początku (dla nazw ulic)
    if (t.length > 0) {
        t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    
    return t.trim();
};

// Uniwersalna funkcja do wywoływania różnych API AI
window.callAIProvider = async function(provider, apiKey, text) {
    const systemPrompt = aiSystemPrompt;
    
    switch(provider) {
        case 'groq':
            try {
                // Groq może nie obsługiwać response_format dla wszystkich modeli
                // Użyjmy modelu który na pewno obsługuje JSON mode
                const requestBody = {
                    model: 'llama-3.1-8b-instant', // Lżejszy model, lepsza kompatybilność
                    messages: [
                        { role: 'system', content: systemPrompt + ' Odpowiedz TYLKO w formacie JSON: {"address": "...", "note": "...", "type": "delivery"|"pickup", "tip": 0}. Pamiętaj: pojedyncze litery po adresie są częścią adresu, NIE notatki! Napiwek to liczba w złotych (0 jeśli brak).' },
                        { role: 'user', content: `Tekst podyktowany przez kuriera: "${text}"` }
                    ],
                    temperature: 0.3,
                    max_tokens: 200
                };
                
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(requestBody)
                });
                
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    console.error('Groq API error:', res.status, errorData);
                    throw new Error(`Groq API ${res.status}: ${errorData.error?.message || JSON.stringify(errorData)}`);
                }
                
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || '';
                
                if (!content) {
                    throw new Error('Pusta odpowiedź z Groq API');
                }
                
                // Spróbuj wyciągnąć JSON z odpowiedzi (może być otoczony tekstem)
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                
                // Jeśli nie ma JSON, spróbuj sparsować całą odpowiedź
                return JSON.parse(content);
            } catch (e) {
                console.error('Groq error:', e);
                throw e;
            }
            
        case 'together':
            try {
                const areaList = window.getMyAreaStreets();
                const extraHint = areaList && areaList.length
                    ? `\nLista ulic w rejonie kuriera (traktuj je jako pewne, nie szukaj innych podobnych nazw w mieście): ${areaList.join(', ')}`
                    : "";
                const res = await fetch('https://api.together.xyz/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'meta-llama/Llama-3-70b-chat-hf',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `Tekst podyktowany przez kuriera: "${text}"${extraHint}` }
                        ],
                        response_format: { type: 'json_object' }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    return JSON.parse(content);
                }
                throw new Error(`Together AI: ${res.status}`);
            } catch (e) {
                console.error('Together error:', e);
                throw e;
            }
            
        case 'openai':
            try {
                const areaList = window.getMyAreaStreets();
                const extraHint = areaList && areaList.length
                    ? `\nLista ulic w rejonie kuriera (traktuj je jako pewne, nie szukaj innych podobnych nazw w mieście): ${areaList.join(', ')}`
                    : "";
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-3.5-turbo',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `Tekst podyktowany przez kuriera: "${text}"${extraHint}` }
                        ],
                        response_format: { type: 'json_object' }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    return JSON.parse(content);
                }
                throw new Error(`OpenAI: ${res.status}`);
            } catch (e) {
                console.error('OpenAI error:', e);
                throw e;
            }
            
        case 'huggingface':
            try {
                const areaList = window.getMyAreaStreets();
                const extraHint = areaList && areaList.length
                    ? `\nLista ulic w rejonie kuriera (traktuj je jako pewne, nie szukaj innych podobnych nazw w mieście): ${areaList.join(', ')}`
                    : "";
                const res = await fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-3-70b-chat-hf', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        inputs: `System: ${systemPrompt}\n\nUser: Tekst podyktowany przez kuriera: "${text}"${extraHint}\n\nAssistant:`,
                        parameters: { return_full_text: false, max_new_tokens: 200 }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text || '';
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
                }
                throw new Error(`Hugging Face: ${res.status}`);
            } catch (e) {
                console.error('Hugging Face error:', e);
                throw e;
            }
            
        case 'gemini':
        default:
            // Gemini API (oryginalna implementacja)
            const modelsToTry = config.geminiModel 
                ? [config.geminiModel, 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro']
                : ['gemma-3-27b', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
            
            for (const modelName of modelsToTry) {
                try {
                    const areaList = window.getMyAreaStreets();
                    const extraHint = areaList && areaList.length
                        ? `\nLista ulic w rejonie kuriera (traktuj je jako pewne, nie szukaj innych podobnych nazw w mieście): ${areaList.join(', ')}`
                        : "";
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: `Tekst podyktowany przez kuriera: "${text}"${extraHint}` }] }],
                            systemInstruction: { parts: [{ text: systemPrompt }] },
                            generationConfig: { responseMimeType: 'application/json' }
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (responseText) {
                            if (config.geminiModel !== modelName) {
                                config.geminiModel = modelName;
                                localStorage.setItem('dpd_config_v12', JSON.stringify(config));
                            }
                            return JSON.parse(responseText);
                        }
                    } else if (res.status !== 404) {
                        throw new Error(`Gemini ${modelName}: ${res.status}`);
                    }
                } catch (e) {
                    if (modelName === modelsToTry[modelsToTry.length - 1]) throw e;
                    continue;
                }
            }
            throw new Error('Gemini: żaden model nie dostępny');
    }
};

window.handleVoiceResult = async function(text) {
    if (!text || text.trim().length < 2) return;
    let aiData = null;
    
    // Odśwież konfigurację z localStorage
    try {
        const savedConfig = JSON.parse(localStorage.getItem('dpd_config_v12') || '{}');
        Object.assign(config, savedConfig);
    } catch(e) {
        console.error('Error loading config:', e);
    }
    
    console.log('AI Provider:', config.aiProvider || 'gemini');
    console.log('API Key length:', config.geminiKey ? config.geminiKey.length : 0);
    
    if (config.aiEnabled) {
        window.setUIProcessing(true);
        try {
            const finalKey = (config.geminiKey || apiKeyDefault).trim();
            
            if (!finalKey || finalKey.trim().length === 0) {
                window.showToast("Brak klucza API", "alert-circle", "text-yellow-500");
                window.setUIProcessing(false);
                return;
            }
            
            const provider = config.aiProvider || 'gemini';
            aiData = await window.callAIProvider(provider, finalKey, text);
            console.log('AI Response:', aiData);
            
        } catch (e) {
            console.error('AI error:', e);
            if (e.message.includes('401') || e.message.includes('403')) {
                window.showToast("Nieprawidłowy klucz API", "key", "text-red-500");
            } else if (e.message.includes('404')) {
                window.showToast("Model niedostępny. Sprawdź ustawienia.", "alert-circle", "text-yellow-500");
            } else {
                window.showToast("Błąd AI: " + e.message, "wifi-off", "text-red-500");
            }
            aiData = null;
        }
        window.setUIProcessing(false);
    }
    
    const low = text.toLowerCase();
    const kw = (config.stopWord || "notatka").toLowerCase();
    const kwRegex = new RegExp(`\\b${kw}\\b`, 'i');
    const splitMatch = text.match(kwRegex);
    const split = splitMatch ? splitMatch.index : -1;
    
    let type = (low.includes('odbiór') || low.includes('odebrać')) ? 'pickup' : 'delivery';
    let addr = text;
    let note = "";
    
    let splitIndex = split;
    
    if (splitIndex === -1) {
        const softKeywords = [
            'napiwek',
            'zostawiono',
            'zostawiona',
            'zostaw',
            'przy drzwiach',
            'przy drzwiach',
            'u sąsiada',
            'u sąsiadki',
            'u sąsiada pod',
            'uwaga'
        ];
        let found = -1;
        for (const kwSoft of softKeywords) {
            const idx = low.indexOf(kwSoft);
            if (idx !== -1 && (found === -1 || idx < found)) {
                found = idx;
            }
        }
        splitIndex = found;
    }
    
    if (splitIndex !== -1) {
        addr = text.substring(0, splitIndex).trim();
        note = text.substring(splitIndex).trim();
    }
    
    if (type === 'pickup') {
        addr = addr.replace(/\b(odbiór|odebrać)\b/gi, '').trim();
    }
    
    addr = addr.replace(/\s+([a-z])\s*$/i, '$1');
    addr = window.formatPolishNumbers(addr);
    
    let tip = 0;
    const tipMatch = note.match(/(\d+(?:[.,]\d+)?)\s*(?:zł|zloty|zlotych|złotych|pln)/i);
    if (tipMatch) {
        tip = parseFloat(tipMatch[1].replace(',', '.')) || 0;
        note = note.replace(/(?:napiwek|dostałem|otrzymałem)\s*(\d+(?:[.,]\d+)?)\s*(?:zł|zloty|zlotych|złotych|pln)/gi, '').trim();
    }
    
    if (aiData) {
        const aiTip = parseFloat(aiData.tip) || 0;
        if (aiTip > 0) {
            tip = aiTip;
        }
        if (aiData.note && typeof aiData.note === 'string' && aiData.note.trim().length > 0) {
            note = note ? `${note} ${aiData.note}` : aiData.note;
        }
    }
    
    window.addEntry(addr, note, type, tip);
};

// Speech Recognition - cross-platform setup
const Recog = window.webkitSpeechRecognition || window.SpeechRecognition;
let recog = null;
let micPermissionStatus = null;

// Funkcja do sprawdzania uprawnień mikrofonu
async function checkMicrophonePermission() {
    if (platform.hasPermissionsAPI) {
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            micPermissionStatus = result.state;
            result.onchange = () => {
                micPermissionStatus = result.state;
            };
            return result.state;
        } catch (e) {
            // Permissions API może nie wspierać 'microphone' na wszystkich przeglądarkach
            return 'prompt';
        }
    }
    return 'prompt'; // Jeśli nie ma Permissions API, zakładamy że trzeba zapytać
}

if (!platform.hasSpeechRecognition) {
    // Ukryj przycisk mikrofonu jeśli nie ma wsparcia
    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
        micBtn.style.opacity = '0.5';
        micBtn.title = "Rozpoznawanie mowy wymaga Chrome/Edge (PC) lub Safari (iOS)";
    }
    if (platform.isDesktop) {
        window.showToast("Rozpoznawanie mowy wymaga Chrome/Edge", "mic-off", "text-yellow-500");
    }
} else {
    recog = new Recog();
    recog.lang = 'pl-PL'; 
    recog.interimResults = true;
    recog.continuous = true; // Ciągłe nagrywanie - użytkownik zatrzyma ręcznie przyciskiem
    recog.maxAlternatives = 1;
    
    // Sprawdź uprawnienia przy starcie
    checkMicrophonePermission();
    
    // Informacja o file:// protocol
    if (platform.isFileProtocol && platform.isDesktop) {
        console.warn('Aplikacja działa na file:// - Chrome nie zapamiętuje uprawnień. Użyj localhost dla lepszego doświadczenia.');
    }
    
    recog.onstart = () => {
        isRecording = true; lastTranscript = ""; interimTranscript = "";
        document.getElementById('micBtn')?.classList.add('pulse-red');
        document.getElementById('livePreview')?.classList.remove('hidden');
        const label = document.getElementById('micLabel');
        if (label) label.style.opacity = '1';
        safeVibrate(10); // Wibracja przy starcie nagrywania
        
        // NIE ustawiaj timeoutu od razu - tylko po wykryciu mowy
        // Wake Lock - tylko na platformach które to wspierają (Android Chrome)
        if (platform.hasWakeLock && !platform.isIOS) {
            navigator.wakeLock.request('screen').then(w => {
                wakeLock = w;
                const wakeDot = document.getElementById('wakeDot');
                const wakeText = document.getElementById('wakeText');
                if (wakeDot) wakeDot.className = "w-1.5 h-1.5 bg-green-500 rounded-full transition-colors";
                if (wakeText) wakeText.textContent = "Blokada: Wł";
            }).catch(() => {
                // Wake Lock nie działa (np. na iOS) - cicho ignoruj
                const wakeDot = document.getElementById('wakeDot');
                const wakeText = document.getElementById('wakeText');
                if (wakeDot) wakeDot.className = "w-1.5 h-1.5 bg-red-500 rounded-full transition-colors";
                if (wakeText) wakeText.textContent = "Blokada: Wył";
            });
        } else if (platform.isIOS) {
            // Na iOS Wake Lock nie działa - ukryj status
            const wakeStatusBox = document.getElementById('wakeStatusBox');
            if (wakeStatusBox) wakeStatusBox.style.display = 'none';
        }
    };
    recog.onresult = (e) => {
        let finalParts = [];
        let inter = '';
        
        // Zbierz wszystkie finalne wyniki (w trybie continuous są dodawane, nie zastępowane)
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
                finalParts.push(e.results[i][0].transcript);
            } else {
                inter += e.results[i][0].transcript;
            }
        }
        
        // Zaktualizuj lastTranscript - zbierz wszystkie finalne części
        if (finalParts.length > 0) {
            // W trybie continuous, dodajemy nowe finalne części do istniejącego tekstu
            lastTranscript = (lastTranscript ? lastTranscript + ' ' : '') + finalParts.join(' ');
        }
        
        interimTranscript = inter;
        
        // Resetuj timeout TYLKO gdy wykryto mowę (finalne lub interim wyniki)
        // Jeśli użytkownik mówi, przedłużamy timeout. Po sekundzie bez mowy zatrzyma się.
        if ((finalParts.length > 0 || inter.length > 0) && isRecording) {
            if (silenceTimeout) clearTimeout(silenceTimeout);
            silenceTimeout = setTimeout(() => {
                if (isRecording && recog) {
                    // Zatrzymaj nagrywanie po sekundzie braku mowy
                    isRecording = false;
                    recog.stop();
                }
            }, 1000);
        }
        
        // Pokaż aktualny tekst (wszystkie finalne + interim)
        const displayText = (lastTranscript ? lastTranscript + (inter ? ' ' : '') : '') + inter;
        document.getElementById('liveText').textContent = displayText || "Słucham...";
    };
    recog.onend = () => {
        // Wyczyść timeout jeśli nagrywanie się zakończyło
        if (silenceTimeout) {
            clearTimeout(silenceTimeout);
            silenceTimeout = null;
        }
        
        isRecording = false;
        document.getElementById('micBtn')?.classList.remove('pulse-red');
        document.getElementById('livePreview')?.classList.add('hidden');
        const label = document.getElementById('micLabel');
        if (label) label.style.opacity = '0';
        safeVibrate([10, 50, 10]); // Podwójna wibracja przy zakończeniu
        
        if (wakeLock) {
            wakeLock.release().then(() => { wakeLock = null; }).catch(() => {});
            const wakeDot = document.getElementById('wakeDot');
            const wakeText = document.getElementById('wakeText');
            if (wakeDot) wakeDot.className = "w-1.5 h-1.5 bg-red-500 rounded-full transition-colors";
            if (wakeText) wakeText.textContent = "Blokada: Wył";
        }
        const finalSpeech = lastTranscript || interimTranscript;
        if (finalSpeech && finalSpeech.trim().length > 0) {
            window.handleVoiceResult(finalSpeech.trim());
        }
    };
    recog.onerror = (e) => {
        console.error('Speech recognition error:', e.error);
        if (e.error === 'not-allowed') {
            micPermissionStatus = 'denied';
            if (platform.isFileProtocol) {
                window.showToast("Chrome nie zapamiętuje uprawnień dla file://. Użyj localhost.", "mic-off", "text-red-500");
            } else {
                window.showToast("Brak uprawnień do mikrofonu. Sprawdź ustawienia przeglądarki.", "mic-off", "text-red-500");
            }
        } else if (e.error === 'no-speech') {
            // Ciche ignorowanie - użytkownik może po prostu nie mówić
        } else if (e.error === 'network') {
            window.showToast("Błąd sieci - sprawdź połączenie", "wifi-off", "text-red-500");
        } else if (e.error === 'service-not-allowed') {
            window.showToast("Usługa rozpoznawania niedostępna", "x", "text-red-500");
        } else {
            window.showToast("Błąd rozpoznawania mowy", "alert-circle", "text-red-500");
        }
    };
    window.toggleRecognition = async () => { 
        // iOS Fix: Warm-up speech synthesis on user interaction
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            // Używamy kropki jako neutralnego znaku, volume 0 aby było cicho
            const warmup = new SpeechSynthesisUtterance(".");
            warmup.volume = 0; 
            warmup.lang = 'pl-PL';
            window.speechSynthesis.speak(warmup);
        }

        if (!isProcessingAI && recog) {
            if (isRecording) {
                // Zatrzymaj nagrywanie i przetwórz wynik
                isRecording = false;
                recog.stop();
            } else {
                // Sprawdź uprawnienia przed uruchomieniem
                const permission = await checkMicrophonePermission();
                
                // Jeśli uprawnienia są odrzucone, pokaż komunikat
                if (permission === 'denied') {
                    window.showToast("Uprawnienia do mikrofonu zostały zablokowane. Sprawdź ustawienia przeglądarki.", "mic-off", "text-red-500");
                    return;
                }
                
                // Jeśli działa na file://, pokaż jednorazową informację
                if (platform.isFileProtocol && platform.isDesktop && !localStorage.getItem('file_protocol_warning_shown')) {
                    window.showToast("Użyj localhost zamiast file:// aby Chrome zapamiętał uprawnienia", "info", "text-yellow-500");
                    localStorage.setItem('file_protocol_warning_shown', 'true');
                }
                
                // Resetuj transkrypcje przed nowym nagraniem
                lastTranscript = "";
                interimTranscript = "";
                
                try {
                    recog.start();
                } catch (e) {
                    console.error('Speech recognition start error:', e);
                    window.showToast("Nie można uruchomić rozpoznawania mowy", "mic-off", "text-red-500");
                }
            }
        }
    };
}

// Fallback jeśli nie ma Speech Recognition
if (!platform.hasSpeechRecognition) {
    window.toggleRecognition = () => {
        window.showToast("Rozpoznawanie mowy nie jest dostępne w tej przeglądarce", "mic-off", "text-red-500");
    };
}

// --- ZAPIS I RENDER ---
window.liczbaNaSlowo = function(n) {
    let numStr = String(n).trim();
    let suffix = "";
    
    // Sprawdź czy jest litera na końcu (np. "131G")
    const match = numStr.match(/^(\d+)([a-zA-Z])$/);
    if (match) {
        numStr = match[1];
        const letter = match[2].toUpperCase();
        const lettersMap = {
            'A': ' a', 'B': ' be', 'C': ' ce', 'D': ' de', 'E': ' e', 'F': ' ef', 'G': ' gie',
            'H': ' ha', 'I': ' i', 'J': ' jot', 'K': ' ka', 'L': ' el', 'M': ' em', 'N': ' en',
            'O': ' o', 'P': ' pe', 'R': ' er', 'S': ' es', 'T': ' te', 'U': ' u', 'W': ' wu',
            'Y': ' igrek', 'Z': ' zet'
        };
        if (lettersMap[letter]) {
            suffix = lettersMap[letter];
        } else {
            suffix = " " + letter.toLowerCase();
        }
    }

    let num = parseInt(numStr, 10);
    if (isNaN(num) || num < 0 || num > 999) return String(n); // Jeśli to nie liczba (lub poza zakresem), zwróć oryginał
    
    const ones = ["zero", "jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć"];
    const teens = {
        10: "dziesięć", 11: "jedenaście", 12: "dwanaście", 13: "trzynaście", 14: "czternaście",
        15: "piętnaście", 16: "szesnaście", 17: "siedemnaście", 18: "osiemnaście", 19: "dziewiętnaście"
    };
    const tens = ["", "dziesięć", "dwadzieścia", "trzydzieści", "czterdzieści", "pięćdziesiąt", "sześćdziesiąt", "siedemdziesiąt", "osiemdziesiąt", "dziewięćdziesiąt"];
    const hundreds = ["", "sto", "dwieście", "trzysta", "czterysta", "pięćset", "sześćset", "siedemset", "osiemset", "dziewięćset"];
    
    let words = "";
    if (num < 10) words = ones[num];
    else if (num >= 10 && num < 20) words = teens[num];
    else if (num < 100) {
        const t = Math.floor(num / 10);
        const u = num % 10;
        words = tens[t] + (u > 0 ? " " + ones[u] : "");
    } else {
        const h = Math.floor(num / 100);
        const rest = num % 100;
        words = hundreds[h];
        if (rest > 0) {
            if (rest < 10) words += " " + ones[rest];
            else if (rest >= 10 && rest < 20) words += " " + teens[rest];
            else {
                const t2 = Math.floor(rest / 10);
                const u2 = rest % 10;
                words += " " + tens[t2];
                if (u2 > 0) words += " " + ones[u2];
            }
        }
    }
    
    return words + suffix;
};

window.formatAddressForSpeech = function(address) {
    if (!address) return "";
    let formatted = address.trim();
    
    // 1. Zamień nazwy ulic zaczynające się od cyfry na słowa (np. 3 Maja -> Trzeciego Maja)
    const numberWords = {
        "1": "Pierwszego", "2": "Drugiego", "3": "Trzeciego", "4": "Czwartego", 
        "5": "Piątego", "6": "Szóstego", "7": "Siódmego", "8": "Ósmego", 
        "9": "Dziewiątego", "10": "Dziesiątego", "11": "Jedenastego", 
        "15": "Piętnastego", "17": "Siedemnastego", "29": "Dwudziestego Dziewiątego",
        "30": "Trzydziestego", "31": "Trzydziestego Pierwszego"
    };
    
    const startMatch = formatted.match(/^(\d+)(\s+.*)/);
    if (startMatch && numberWords[startMatch[1]]) {
        formatted = numberWords[startMatch[1]] + startMatch[2];
    }
    
    // 2. Wstaw przecinek przed numerem domu (oddzielenie ulicy od numeru)
    // Szukamy spacji przed cyfrą, gdzie wcześniej nie było cyfry
    formatted = formatted.replace(/([^\d])\s+(\d)/g, "$1, $2");
    
    // 3. Zamień "/" na " przez " (musi być po kroku 2, żeby nie wstawiać przecinka przed 3 w "102/3")
    formatted = formatted.replace(/\//g, " przez ");
    
    // 4. Zamień liczby (i liczby z literami np. 131G) na słowa
    // Regex łapie ciągi cyfr, opcjonalnie z jedną literą na końcu
    formatted = formatted.replace(/\b\d+[a-zA-Z]?\b/g, function(match) {
        return window.liczbaNaSlowo(match);
    });
    
    return formatted;
};

window.addEntry = function(addr, note = "", type = 'delivery', tip = 0, isAuto = false) {
    if (!addr || addr.trim().length < 2) return;
    
    // Normalizuj adres - zachowaj ukośniki i popraw format
    let normalizedAddr = addr.trim();
    
    // Upewnij się, że ukośniki są zachowane (nie ma spacji wokół)
    normalizedAddr = normalizedAddr.replace(/\s*\/\s*/g, '/');
    
    // Wielka litera na początku (dla nazw ulic)
    if (normalizedAddr.length > 0) {
        normalizedAddr = normalizedAddr.charAt(0).toUpperCase() + normalizedAddr.slice(1);
    }
    
    // 1. Połącz cyfrę i literę (usuń spację): "131 g" -> "131g"
    normalizedAddr = normalizedAddr.replace(/(\d+)\s+([a-zA-Z])(?!\w)/g, '$1$2');
    
    // 2. Zamień litery przy liczbach na wielkie: "131g" -> "131G"
    normalizedAddr = normalizedAddr.replace(/(\d+)([a-zA-Z])/g, function(match, num, letter) {
        return num + letter.toUpperCase();
    });
    
    // Upewnij się że tip jest liczbą
    const tipValue = parseFloat(tip) || 0;
    
    const inMyArea = window.isAddressInMyArea(normalizedAddr);
    const entry = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }),
        date: getTodayStr(),
        address: normalizedAddr,
        note: (note || "").trim(),
        tip: tipValue, type, lat: null, lng: null, outOfArea: !inMyArea
    };
    addresses.unshift(entry);
    window.saveAndRender();
    const tipMsg = tipValue > 0 ? ` + ${tipValue.toFixed(2)} zł napiwek` : '';
    window.showToast(`Dodano stop${tipMsg}`, "check", "text-green-500");
    
    // Voice Confirmation
    if (config.voiceConfirmationEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const formattedAddr = window.formatAddressForSpeech(entry.address);
        let msg = `Dodano ${type === 'pickup' ? 'odbiór' : 'doręczenie'} pod adresem ${formattedAddr}.`;
        if (tipValue > 0) {
            msg += ` Napiwek ${tipValue} złotych.`;
        }
        if (entry.note && entry.note.length > 0 && !isAuto) {
            msg += ` Notatka: ${entry.note}.`;
        }
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.lang = 'pl-PL';
        utterance.rate = 0.88;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    }

    if (config.gpsEnabled) {
    window.geocodeAddress(entry.address).then(coords => {
        if (coords) {
            entry.lat = coords.lat; entry.lng = coords.lng;
            localStorage.setItem('dpd_logs_v13', JSON.stringify(addresses));
            if (currentView === 'map') window.renderMarkers();
        }
        }).catch(err => {
            console.error('Geocoding error:', err);
    });
    }
};

window.saveAndRender = function() {
    localStorage.setItem('dpd_logs_v13', JSON.stringify(addresses));
    const today = getTodayStr();
    const todayLogs = addresses.filter(a => a.date === today);
    document.getElementById('deliveryCounter').textContent = todayLogs.filter(a => a.type === 'delivery').length;
    document.getElementById('pickupCounter').textContent = todayLogs.filter(a => a.type === 'pickup').length;
    document.getElementById('tipTotal').textContent = todayLogs.reduce((s, c) => s + (parseFloat(c.tip) || 0), 0).toFixed(2) + " zł";
    
    const listEl = document.getElementById('addressList');
    if (listEl) {
        if (todayLogs.length === 0) {
            listEl.innerHTML = ''; document.getElementById('emptyState')?.classList.remove('hidden');
        } else {
            document.getElementById('emptyState')?.classList.add('hidden');
            listEl.innerHTML = todayLogs.map(item => {
                const customer = customers.find(c => c.address === item.address);
                return `
                <li class="bg-white dark:bg-zinc-800 p-4 rounded-2xl shadow-sm border-l-4 ${item.type === 'pickup' ? 'border-zinc-500' : 'border-dpd-red'} border-y border-r border-gray-100 dark:border-zinc-700">
                    <div class="flex justify-between items-start text-left mb-2">
                        <div class="flex-1 min-w-0">
                            <span class="text-[10px] font-black uppercase opacity-60 text-left block">${item.type === 'pickup' ? 'Odbiór' : 'Doręczenie'} ${item.time}</span>
                            <p class="text-base font-bold mt-1 text-left pr-2 break-words">${item.address}</p>
                            ${item.outOfArea ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full border border-orange-300 bg-orange-50 text-[10px] font-black uppercase text-orange-700 dark:border-orange-500/60 dark:bg-orange-900/30 dark:text-orange-200 mt-1">Poza rejonem</span>` : ''}
                        </div>
                        <div class="flex gap-1 shrink-0 text-left">
                            <button onclick="window.toggleType(${item.id})" class="p-1 opacity-40 hover:opacity-100"><i data-lucide="${item.type === 'pickup' ? 'package-plus' : 'truck'}" class="w-4 h-4 text-left"></i></button>
                            <button onclick="window.openEditModal(${item.id})" class="p-1 opacity-40 hover:opacity-100"><i data-lucide="pencil" class="w-4 h-4 text-left"></i></button>
                            <button onclick="window.openCustomerModal('${item.address}')" class="p-1 ${customer ? 'text-blue-500 opacity-100' : 'opacity-40 hover:opacity-100'}"><i data-lucide="user" class="w-4 h-4 text-left"></i></button>
                            <button onclick="window.openTipModal(${item.id})" class="p-1 ${item.tip > 0 ? 'text-green-500 opacity-100' : 'opacity-40 hover:opacity-100'}"><i data-lucide="banknote" class="w-4 h-4 text-left"></i></button>
                            <button onclick="window.handleConfirmAction('delete_stop', ${item.id})" class="p-1 text-red-400 opacity-40 hover:opacity-100"><i data-lucide="trash-2" class="w-4 h-4 text-left"></i></button>
                        </div>
                    </div>
                    ${customer ? `
                        <div class="mt-2 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/50 flex justify-between items-center gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-1.5 mb-0.5">
                                    <i data-lucide="user" class="w-3 h-3 text-blue-500"></i>
                                    <span class="text-xs font-bold text-blue-700 dark:text-blue-300 truncate">${customer.name}</span>
                                </div>
                                ${customer.static_note ? `<p class="text-[11px] text-blue-600/80 dark:text-blue-400/80 leading-tight break-words">${customer.static_note}</p>` : ''}
                            </div>
                            ${customer.phone ? `
                                <a href="tel:${customer.phone}" class="flex-none w-10 h-10 flex items-center justify-center bg-green-500 hover:bg-green-600 text-white rounded-xl shadow-sm transition-colors" onclick="event.stopPropagation()">
                                    <i data-lucide="phone" class="w-5 h-5"></i>
                                </a>
                            ` : ''}
                        </div>
                    ` : ''}
                    ${item.note ? `<p class="mt-2 text-xs opacity-60 italic border-t border-gray-50 dark:border-zinc-700 pt-1 text-left">${item.note}</p>` : ''}
                </li>`
            }).join('');
        }
    }
    lucide.createIcons();
    window.setAIStatusUI();
};

// --- MAPA & HISTORIA ---
window.toggleView = function(v) {
    ['listView', 'mapView', 'settingsView', 'statsView', 'aiSettingsView', 'customersView', 'historyView', 'myAreaView', 'routeAnalysisView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('view-hidden');
    });
    const viewEl = document.getElementById(v + 'View');
    if (viewEl) viewEl.classList.remove('view-hidden');
    
    currentView = v;
    const btnText = document.getElementById('toggleText');
    const btnIcon = document.getElementById('toggleIcon');
    if (v === 'map') {
        if (btnText) btnText.textContent = "Lista";
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'list');
        if (!map) {
            map = L.map('map', { zoomControl: false }).setView([52.23, 21.01], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            markersGroup = L.layerGroup().addTo(map);
        }
        setTimeout(() => { map.invalidateSize(); window.renderMarkers(); }, 200);
    } else {
        if (btnText) btnText.textContent = "Mapa";
        if (btnIcon) btnIcon.setAttribute('data-lucide', 'map');
    }
    
    if (v === 'stats') {
        setTimeout(window.renderStatistics, 100);
    }

    if (v === 'history') {
        setTimeout(window.renderHistory, 100);
    }

    if (v === 'customers') {
        setTimeout(window.renderCustomersList, 100);
    }

    if (v === 'routeAnalysis') {
        setTimeout(window.renderMasterRoute, 100);
    }
    
    lucide.createIcons();
};

const WakeLockManager = {
    wakeLock: null,
    wakeVideo: null,

    createVideoElement: function() {
        if (this.wakeVideo) return;
        this.wakeVideo = document.createElement('video');
        this.wakeVideo.setAttribute('playsinline', '');
        this.wakeVideo.setAttribute('webkit-playsinline', ''); // for iOS 10+
        this.wakeVideo.setAttribute('no-widget', '');
        this.wakeVideo.setAttribute('loop', '');
        this.wakeVideo.setAttribute('muted', '');
        this.wakeVideo.setAttribute('hidden', '');
        
        // Valid blank 1x1 MP4 video base64
        this.wakeVideo.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAQAAAAAYbW9vdgAAAGxtdmhkAAAAAAAZN4QAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGGlvZHMAAAAAEICAgAcAT////3//AAACQXRyYWsAAAXjAAAAMHRraGQAAAABAAAAAQAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAABAAAAAAHgbWRpYQAAACBtZGlhAAAAIG1kaGQAAAAAABk3hAAAAAAAAAAAAAEAAAAAAAARaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAAAAAAGWbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABVnN0YmwAAACpc3RzZAAAAAAAAAABAAAAmWF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAQABAAAAAAAIAAAACAAAAAAAAAAAAAAAEAVjZmZyAAAADkFhY2xpbjEuMC4xAAACAGF2Y0MBAAAALgECA/8AIF9iA/8AIf8LAAAADAECA/8AAQAaYXNsAAAAAAABAAAAAAB4AAAAPmN0dHMAAAAAAAAACAAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAA3N0dHMAAAAAAAAAAQAAAA0AAAABAAAAFHN0c3oAAAAAAAAAEAAAAAIAAAABc3RzYwAAAAAAAAABAAAAAQAAAA0AAAABAAAAFHN0Y28AAAAAAAAAAQAAAEYAAAAYdHJheQAAAABraGlkAAAAAQAACAAAAAB1ZHRhAAAAZ21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTguMjkuMTAw';
        
        // Fallback for Safari which is picky about base64 src in video
        this.wakeVideo.type = 'video/mp4';
        
        document.body.appendChild(this.wakeVideo);
    },

    toggle: async function(enabled) {
        // Video Loop Hack (for iOS/Android background execution)
        if (!this.wakeVideo) {
            this.createVideoElement();
        }

        if (enabled) {
            // Screen Wake Lock API
            if ('wakeLock' in navigator) {
                try {
                    this.wakeLock = await navigator.wakeLock.request('screen');
                    this.wakeLock.addEventListener('release', () => {
                        console.log('Wake Lock released');
                        this.wakeLock = null;
                        this.updateUI(false);
                    });
                    console.log('Wake Lock active');
                } catch (err) {
                    console.error(`Wake Lock error: ${err.name}, ${err.message}`);
                }
            }
            
            // Video Hack
            try {
                await this.wakeVideo.play();
                console.log('Wake Video playing');
            } catch(e) {
                console.error('Wake Video error:', e);
            }

            this.updateUI(true);
        } else {
            if (this.wakeLock) {
                await this.wakeLock.release();
                this.wakeLock = null;
            }
            if (this.wakeVideo) {
                this.wakeVideo.pause();
            }
            this.updateUI(false);
        }
    },
    
    updateUI: function(active) {
        const wakeDot = document.getElementById('wakeDot');
        const wakeText = document.getElementById('wakeText');
        if (wakeDot) wakeDot.className = `w-1.5 h-1.5 ${active ? 'bg-green-500' : 'bg-red-500'} rounded-full transition-colors`;
        if (wakeText) wakeText.textContent = active ? "Blokada: Wł" : "Blokada: Wył";
    },

    init: function() {
        // Create video element proactively
        if (!this.wakeVideo) {
            this.createVideoElement();
        }
        
        // Setup first interaction listener to unlock audio/video context
        const unlock = async () => {
            if (this.wakeVideo) {
                try {
                    await this.wakeVideo.play();
                    if (!this.wakeLock) { 
                        // If not enabled, pause immediately. 
                        // If enabled, keep playing (loop)
                        const isEnabled = document.getElementById('wakeDot')?.classList.contains('bg-green-500');
                        if (!isEnabled) this.wakeVideo.pause();
                    }
                } catch(e) {
                    console.log('Autoplay unlock failed', e);
                }
            }
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);
    }
};

window.toggleWakeLock = (enabled) => WakeLockManager.toggle(enabled);

window.toggleMenu = function() {
    const menu = document.getElementById('menuDropdown');
    if (menu) {
        menu.classList.toggle('hidden');
    }
};

let stopsChartInstance = null;
let tipsChartInstance = null;

window.renderStatistics = function() {
    const ctxStops = document.getElementById('stopsChart');
    const ctxTips = document.getElementById('tipsChart');
    if (!ctxStops || !ctxTips) return;

    // Prepare data (Last 7 days)
    const labels = [];
    const dataStops = [];
    const dataTips = [];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayStr = d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        labels.push(dayStr.slice(0, 5)); // "DD.MM"
        
        const dayLogs = addresses.filter(a => a.date === dayStr);
        dataStops.push(dayLogs.length);
        dataTips.push(dayLogs.reduce((acc, curr) => acc + (parseFloat(curr.tip) || 0), 0));
    }

    // Colors
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#a1a1aa' : '#71717a';

    // Stops Chart
    if (stopsChartInstance) stopsChartInstance.destroy();
    stopsChartInstance = new Chart(ctxStops, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Liczba stopów',
                data: dataStops,
                backgroundColor: '#dc0032',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: textColor } }
            },
            plugins: { legend: { display: false } }
        }
    });

    // Tips Chart
    if (tipsChartInstance) tipsChartInstance.destroy();
    tipsChartInstance = new Chart(ctxTips, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Napiwki (PLN)',
                data: dataTips,
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#22c55e',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } },
                x: { grid: { display: false }, ticks: { color: textColor } }
            },
            plugins: { legend: { display: false } }
        }
    });
};

window.handleMapToggle = () => currentView === 'map' ? window.toggleView('list') : window.toggleView('map');

window.renderMarkers = () => {
    if (!markersGroup) return; markersGroup.clearLayers();
    const today = getTodayStr();
    const logs = addresses.filter(a => a.date === today && a.lat);
    if (!logs.length) return;
    const groups = {};
    logs.forEach(log => { const key = `${log.lat}_${log.lng}`; if (!groups[key]) groups[key] = []; groups[key].push(log); });
    const bounds = L.latLngBounds();
    Object.values(groups).forEach(stops => {
        const count = stops.length; const first = stops[0];
        
        // Określ typy stopów w grupie
        const hasPickup = stops.some(s => s.type === 'pickup');
        const hasDelivery = stops.some(s => s.type === 'delivery');
        
        // Określ kolor pinezki
        let pinColor = '#dc0032'; // Domyślnie czerwony (doręczenie)
        if (hasPickup && !hasDelivery) {
            pinColor = '#71717a'; // Grafitowy (tylko odbiór)
        } else if (hasPickup && hasDelivery) {
            // Dwukolorowa - użyj gradientu lub dwóch kolorów
            pinColor = 'linear-gradient(135deg, #dc0032 0%, #dc0032 50%, #71717a 50%, #71717a 100%)';
        }
        
        // Utwórz ikonę z odpowiednim kolorem
        let pinIconHtml;
        if (hasPickup && hasDelivery) {
            // Dwukolorowa pinezka - czerwony na górze, grafitowy na dole
            pinIconHtml = `<div class="marker-pin-wrapper relative"><svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gradient-${first.id}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#dc0032;stop-opacity:1" /><stop offset="50%" style="stop-color:#dc0032;stop-opacity:1" /><stop offset="50%" style="stop-color:#71717a;stop-opacity:1" /><stop offset="100%" style="stop-color:#71717a;stop-opacity:1" /></linearGradient></defs><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="url(#gradient-${first.id})"/></svg>${count > 1 ? `<div class="marker-badge">${count}</div>` : ''}</div>`;
        } else {
            // Jednokolorowa pinezka
            const colorClass = hasPickup ? 'text-zinc-500' : 'text-dpd-red';
            pinIconHtml = `<div class="marker-pin-wrapper"><i data-lucide="map-pin" class="w-8 h-8 ${colorClass}"></i>${count > 1 ? `<div class="marker-badge">${count}</div>` : ''}</div>`;
        }
        
        const icon = L.divIcon({ html: pinIconHtml, className: 'custom-icon', iconSize: [32, 32], iconAnchor: [16, 32] });
        const popupContent = `<div class="p-2 min-w-[150px] text-left text-left"><p class="text-[10px] font-black uppercase text-dpd-red mb-2 border-b pb-1 text-left">${first.address}</p><ul class="space-y-2">${stops.map(s => `<li class="text-[9px] leading-tight text-left"><span class="font-bold">${s.time}</span> - <span class="${s.type === 'pickup' ? 'text-zinc-400' : 'text-dpd-red'} uppercase font-black">${s.type === 'pickup' ? 'Odbiór' : 'Doręcz'}</span>${s.note ? `<br><span class="opacity-60 italic">${s.note}</span>` : ''}</li>`).join('')}</ul></div>`;
        L.marker([first.lat, first.lng], { icon }).bindPopup(popupContent).addTo(markersGroup);
        bounds.extend([first.lat, first.lng]);
    });
    map.fitBounds(bounds, { padding: [50, 50] }); lucide.createIcons();
};

// Funkcja do obsługi rozwijania kafelków (nie jest już potrzebna switchSettingsTab, ale zostawiamy dla kompatybilności)
window.switchSettingsTab = (tab) => {
    // Przekieruj na odpowiedni kafelek
    if (tab === 'config') {
        const configContent = document.getElementById('configContent');
        if (configContent && configContent.classList.contains('hidden')) {
            configContent.classList.remove('hidden');
            const chevron = document.getElementById('configChevron');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
    } else if (tab === 'history') {
        const historyContent = document.getElementById('historyContent');
        if (historyContent && historyContent.classList.contains('hidden')) {
            historyContent.classList.remove('hidden');
            window.renderHistory();
            const chevron = document.getElementById('historyChevron');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        }
    }
    lucide.createIcons();
};

window.renderHistory = () => {
    const list = document.getElementById('historyList');
    const grouped = addresses.reduce((acc, curr) => { if (!acc[curr.date]) acc[curr.date] = { date: curr.date, stops: [] }; acc[curr.date].stops.push(curr); return acc; }, {});
    const sorted = Object.keys(grouped).sort((a,b) => { const partsA = a.split('.'), partsB = b.split('.'); return new Date(partsB[2], partsB[1]-1, partsB[0]) - new Date(partsA[2], partsA[1]-1, partsA[0]); });
    
    list.innerHTML = sorted.map(k => {
        const dayStops = grouped[k].stops;
        const totalTips = dayStops.reduce((sum, s) => sum + (parseFloat(s.tip) || 0), 0);
        const countDelivery = dayStops.filter(s => s.type === 'delivery').length;
        const countPickup = dayStops.filter(s => s.type === 'pickup').length;
        
        return `<div class="bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border border-gray-100 dark:border-zinc-800 overflow-hidden mb-4">
            <div class="p-4 flex justify-between items-center bg-white/50 dark:bg-black/20 text-left cursor-pointer" onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.chevron-icon').classList.toggle('rotate-180')">
                <div class="text-left flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <p class="text-[11px] font-black uppercase text-dpd-red leading-none text-left">${grouped[k].date}</p>
                        ${totalTips > 0 ? `<span class="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded">+${totalTips.toFixed(2)} zł</span>` : ''}
                    </div>
                    <p class="text-[10px] text-gray-500 dark:text-zinc-500">
                        ${countDelivery} doręczeń • ${countPickup} odbiorów
                    </p>
                </div>
                <button class="p-2 text-gray-400 text-left transition-transform duration-200 chevron-icon"><i data-lucide="chevron-down" class="w-4 h-4 text-left"></i></button>
            </div>
            <div class="hidden p-4 space-y-2 border-t border-gray-100 dark:border-zinc-800 text-left">
                ${dayStops.map(s => `
                <div class="flex justify-between items-start text-[10px] text-left border-b border-gray-100 dark:border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                    <span class="font-mono opacity-60 mr-2">${s.time}</span>
                    <div class="flex-1 min-w-0 mr-2">
                        <span class="truncate block font-medium">${s.address}</span>
                        ${s.note ? `<span class="block opacity-60 italic text-[9px] truncate">${s.note}</span>` : ''}
                    </div>
                    <div class="flex flex-col items-end shrink-0">
                        <span class="font-black ${s.type === 'pickup' ? 'text-zinc-400' : 'text-dpd-red'} text-left uppercase text-[9px]">${s.type === 'pickup' ? 'Odbiór' : 'Doręcz'}</span>
                        ${s.tip > 0 ? `<span class="text-green-500 font-bold text-[9px]">+${s.tip} zł</span>` : ''}
                    </div>
                </div>`).join('')}
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
};

window.exportFullCSV = () => {
    const data = addresses;
    if (!data.length) {
        window.showToast("Brak danych do eksportu", "file-x", "text-yellow-500");
        return;
    }
    let csv = "\uFEFFData;Godzina;Typ;Adres;Notatka;Napiwek;Szerokość;Długość\n" + 
        data.map(r => `${r.date};${r.time};${r.type};"${r.address}";"${r.note}";${r.tip};${r.lat || ''};${r.lng || ''}`).join("\n");
    
    const b = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(b);
    link.download = `Raport_Pelny_${getTodayStr().replace(/\./g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.showToast("Eksportowano pełny CSV", "file-spreadsheet", "text-green-500");
};

window.updateApiKeyPlaceholder = function() {
    const provider = document.getElementById('setAiProvider')?.value || 'groq';
    const input = document.getElementById('setGeminiKey');
    const label = document.getElementById('apiKeyLabel');
    const info = document.getElementById('providerInfo');
    
    const providerInfo = {
        groq: { label: 'Klucz API Groq', placeholder: 'Wklej klucz API z console.groq.com...', info: '~14k darmowych zapytań/dzień' },
        together: { label: 'Klucz API Together AI', placeholder: 'Wklej klucz API z together.ai...', info: 'Darmowy tier dostępny' },
        openai: { label: 'Klucz API OpenAI', placeholder: 'Wklej klucz API z platform.openai.com...', info: 'GPT-3.5-turbo (darmowy tier)' },
        huggingface: { label: 'Token Hugging Face', placeholder: 'Wklej token z huggingface.co...', info: 'Darmowe modele open-source' },
        gemini: { label: 'Klucz API Google Gemini', placeholder: 'Wklej klucz API z Google AI Studio...', info: 'Google Gemini API' }
    };
    
    const infoText = providerInfo[provider] || providerInfo.groq;
    if (label) label.textContent = infoText.label;
    if (input) input.placeholder = infoText.placeholder;
    if (info) info.textContent = infoText.info;
};

window.applySettings = debounce(() => {
    config.aiEnabled = document.getElementById('setAiEnabled').checked;
    const newKey = document.getElementById('setGeminiKey').value.trim();
    config.geminiKey = newKey;
    config.aiProvider = document.getElementById('setAiProvider')?.value || 'groq';
    config.city = document.getElementById('setCity').value;
    config.theme = document.getElementById('setTheme').value;
    config.stopWord = document.getElementById('setStopWord').value || "notatka";
    config.gpsEnabled = document.getElementById('setGpsEnabled').checked;
    config.wakeLockEnabled = document.getElementById('setWakeLockEnabled').checked;
    config.carAssistantEnabled = document.getElementById('setCarAssistantEnabled').checked;
    config.voiceConfirmationEnabled = document.getElementById('setVoiceConfirmationEnabled').checked;
    config.smartAssistantEnabled = document.getElementById('setSmartAssistantEnabled').checked;
    config.proximityRadius = parseInt(document.getElementById('setProximityRadius').value) || 40;
    
    localStorage.setItem('dpd_config_v12', JSON.stringify(config));
    console.log('Settings saved. AI provider:', config.aiProvider, 'AI enabled:', config.aiEnabled);
    
    window.updateApiKeyPlaceholder();
    window.setAIStatusUI();
    window.toggleWakeLock(config.wakeLockEnabled);
    if (window.CarAssistant) CarAssistant.setActive(config.carAssistantEnabled);
    if (window.SmartAssistant) SmartAssistant.setActive(config.smartAssistantEnabled);
    
    sunTimes = null;
    window.refreshTheme();
    window.saveAndRender();
}, 500);

// Funkcja do listowania dostępnych modeli
window.listAvailableModels = async function() {
    const key = document.getElementById('setGeminiKey').value.trim();
    if (!key) {
        window.showToast("Wprowadź klucz API", "alert-circle", "text-yellow-500");
        return;
    }
    
    window.showToast("Sprawdzam dostępne modele...", "loader", "text-blue-500");
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (res.ok) {
            const data = await res.json();
            const models = data.models || [];
            const generateContentModels = models
                .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => m.name.replace('models/', ''))
                .sort();
            
            console.log('Dostępne modele:', generateContentModels);
            const modelsList = generateContentModels.join(', ');
            window.showToast(`Modele: ${modelsList.substring(0, 100)}${modelsList.length > 100 ? '...' : ''}`, "info", "text-green-500");
            
            // Zapisz pierwszy dostępny model jako sugerowany
            if (generateContentModels.length > 0) {
                const suggestedModel = generateContentModels.find(m => m.includes('gemini')) || generateContentModels[0];
                console.log('Sugerowany model:', suggestedModel);
            }
            
            return generateContentModels;
        } else {
            const error = await res.json().catch(() => ({}));
            console.error('List models error:', res.status, error);
            window.showToast(`Błąd: ${res.status}`, "x", "text-red-500");
        }
    } catch (e) {
        console.error('List models exception:', e);
        window.showToast("Błąd: " + e.message, "wifi-off", "text-red-500");
    }
};

// Funkcja do testowania klucza API
window.testApiKey = async function() {
    const key = document.getElementById('setGeminiKey').value.trim();
    if (!key) {
        window.showToast("Wprowadź klucz API", "alert-circle", "text-yellow-500");
        return;
    }
    
    const provider = document.getElementById('setAiProvider')?.value || config.aiProvider || 'groq';
    window.showToast(`Testuję klucz API (${provider})...`, "loader", "text-blue-500");
    
    try {
        await window.callAIProvider(provider, key, "Test");
        window.showToast(`Klucz API działa! (${provider})`, "check", "text-green-500");
    } catch (e) {
        console.error('API test error:', e);
        if (e.message.includes('401') || e.message.includes('403')) {
            window.showToast("Nieprawidłowy klucz API", "key", "text-red-500");
        } else {
            window.showToast(`Błąd: ${e.message}`, "x", "text-red-500");
        }
    }
};
window.toggleType = (id) => { const idx = addresses.findIndex(a => a.id === id); if (idx !== -1) { addresses[idx].type = addresses[idx].type === 'delivery' ? 'pickup' : 'delivery'; window.saveAndRender(); } };
window.deleteAddress = (id) => { addresses = addresses.filter(a => a.id != id); window.saveAndRender(); window.showToast("Usunięto stop", "trash", "text-red-500"); };
window.confirmReset = () => { const today = getTodayStr(); addresses = addresses.filter(a => a.date !== today); window.saveAndRender(); window.showToast("Zresetowano dzień", "trash", "text-red-500"); };
window.confirmAllClear = () => { addresses = []; window.saveAndRender(); window.showToast("Wyczyszczono historię", "trash", "text-red-500"); };
window.openTipModal = (id) => { 
    activeTipId = id; 
    const it = addresses.find(a => a.id === id); 
    if (it) { 
        document.getElementById('tipAddress').textContent = it.address; 
        document.getElementById('tipInput').value = it.tip > 0 ? it.tip : "";
        document.getElementById('tipModal').classList.add('modal-active'); 
        setTimeout(() => document.getElementById('tipInput').focus(), 100);
    } 
};
window.closeTipModal = () => document.getElementById('tipModal').classList.remove('modal-active');
window.confirmTip = () => { const val = parseFloat(document.getElementById('tipInput').value) || 0; const idx = addresses.findIndex(a => a.id === activeTipId); if (idx !== -1) { addresses[idx].tip = val; window.saveAndRender(); } window.closeTipModal(); };
window.exportToCSV = () => { const today = getTodayStr(); const data = addresses.filter(a => a.date === today); if (!data.length) { window.showToast("Brak danych do eksportu", "file-x", "text-yellow-500"); return; } let csv = "\uFEFFData;Godzina;Typ;Adres;Notatka;Napiwek;Szerokość;Długość\n" + data.map(r => `${r.date};${r.time};${r.type};"${r.address}";"${r.note}";${r.tip};${r.lat || ''};${r.lng || ''}`).join("\n"); const b = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.href = URL.createObjectURL(b); link.download = `Raport_${today.replace(/\./g, '_')}.csv`; link.click(); window.showToast("Eksportowano CSV", "file-spreadsheet", "text-green-500"); };

window.exportBackup = () => {
    const backup = { addresses, config, version: '1.0', date: new Date().toISOString() };
    const json = JSON.stringify(backup, null, 2);
    const b = new Blob([json], { type: 'application/json' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(b);
    link.download = `DPD_Backup_${getTodayStr().replace(/\./g, '_')}.json`;
    link.click();
    window.showToast("Eksportowano backup", "download", "text-green-500");
};

window.importBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const backup = JSON.parse(e.target.result);
            if (backup.addresses && Array.isArray(backup.addresses)) {
                if (confirm(`Zaimportować ${backup.addresses.length} stopów? Obecne dane zostaną zastąpione.`)) {
                    addresses = backup.addresses;
                    if (backup.config) config = { ...config, ...backup.config };
                    localStorage.setItem('dpd_logs_v13', JSON.stringify(addresses));
                    localStorage.setItem('dpd_config_v12', JSON.stringify(config));
                    window.saveAndRender();
                    window.showToast("Zaimportowano backup", "upload", "text-green-500");
                }
            } else {
                window.showToast("Nieprawidłowy format backupu", "alert-triangle", "text-red-500");
            }
        } catch (err) {
            window.showToast("Błąd importu", "x", "text-red-500");
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
};

window.clearGeocodeCache = () => {
    if (confirm("Wyczyścić cache geokodowania? Adresy będą geokodowane ponownie.")) {
        geocodeCache = {};
        localStorage.removeItem('geocode_cache_v1');
        window.showToast("Cache wyczyszczony", "trash", "text-green-500");
    }
};

window.exportMyAreaBackup = () => {
    const list = window.getMyAreaStreets();
    if (!list || !list.length) {
        window.showToast("Brak ulic w rejonie do eksportu", "file-x", "text-yellow-500");
        return;
    }
    const backup = {
        type: 'myAreaStreets',
        version: '1.0',
        date: new Date().toISOString(),
        streets: list
    };
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `DPD_MyArea_${getTodayStr().replace(/\./g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.showToast("Eksportowano rejon", "download", "text-green-500");
};

window.importMyAreaBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data && Array.isArray(data.streets)) {
                if (data.type && data.type !== 'myAreaStreets') {
                    window.showToast("Niewłaściwy typ pliku backupu", "alert-triangle", "text-red-500");
                } else {
                    const count = data.streets.length;
                    if (count === 0) {
                        window.showToast("Backup nie zawiera ulic", "file-x", "text-yellow-500");
                    } else if (confirm(`Zaimportować ${count} ulic do rejonu? Obecna lista zostanie zastąpiona.`)) {
                        myAreaStreets = data.streets.map(s => String(s).toUpperCase());
                        localStorage.setItem('myAreaStreets', JSON.stringify(myAreaStreets));
                        myAreaEditIndex = -1;
                        const btn = document.getElementById('myAreaAddBtn');
                        const input = document.getElementById('myAreaInput');
                        if (btn) btn.textContent = "Dodaj";
                        if (input) input.value = "";
                        window.renderMyAreaStreets();
                        window.showToast("Zaimportowano rejon", "upload", "text-green-500");
                    }
                }
            } else {
                window.showToast("Nieprawidłowy format backupu rejonu", "alert-triangle", "text-red-500");
            }
        } catch (err) {
            window.showToast("Błąd importu rejonu", "x", "text-red-500");
        }
    };
    reader.readAsText(file);
    event.target.value = '';
};

// --- CAR ASSISTANT (INTELIGENTNE WYKRYWANIE) ---
const CarAssistant = {
    batteryListener: null,
    watchId: null,
    lastChargeState: false,
    lastTriggerTime: 0,
    active: false,
    
    init: function() {
        if (config.carAssistantEnabled) {
            this.start();
        }
    },

    setActive: function(enabled) {
        if (enabled) this.start();
        else this.stop();
    },

    start: function() {
        if (this.active) return;
        this.active = true;
        console.log('CarAssistant: Starting...');

        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                this.lastChargeState = battery.charging;
                const handler = () => this.handleChargingChange(battery.charging);
                this.batteryHandler = handler;
                if (typeof battery.addEventListener === 'function') {
                    battery.addEventListener('chargingchange', handler);
                } else if ('onchargingchange' in battery) {
                    battery.onchargingchange = handler;
                } else {
                    console.log('CarAssistant: Battery API has no chargingchange listener');
                }
                console.log('CarAssistant: Battery listener initialized', battery.charging);
            }).catch(e => console.log('Battery API error:', e));
        }
        
        if (platform.hasGeolocation) {
            this.watchId = navigator.geolocation.watchPosition(
                (pos) => this.handleMovement(pos),
                (err) => console.log('CarAssistant GPS error:', err),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        }
        window.showToast("Wykrywanie powrotu włączone", "zap", "text-green-500");
    },

    stop: function() {
        if (!this.active) return;
        this.active = false;
        console.log('CarAssistant: Stopping...');
        
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        // Battery listener cleanup is tricky without storing the battery object, but for PWA it's fine.
        window.showToast("Wykrywanie powrotu wyłączone", "zap-off", "text-gray-500");
    },
    
    handleChargingChange: function(isCharging) {
        if (!this.active) return;
        // Wykryj moment podłączenia ładowania (start silnika)
        // Logika: zmiana z false na true
        if (isCharging && !this.lastChargeState) {
            console.log('CarAssistant: Engine start detected (charging started)');
            // Sprawdź warunek czasu (2 minuty od ostatniego wpisu)
            this.checkAndTrigger(2 * 60 * 1000); 
        }
        this.lastChargeState = isCharging;
    },
    
    handleMovement: function(pos) {
        if (!this.active) return;
        // Wykryj ruch gdy ładowanie jest aktywne
        // Prędkość > 7 km/h (ok. 1.95 m/s)
        if (this.lastChargeState && pos.coords.speed > 1.95) {
            // Sprawdź warunek czasu (5 minut od ostatniego wpisu)
            // Dodatkowy debounce dla ruchu (żeby nie spamować co chwilę) - np. 5 minut od ostatniego triggera
            const now = Date.now();
            if (now - this.lastTriggerTime > 5 * 60 * 1000) {
                this.checkAndTrigger(5 * 60 * 1000, true);
            }
        }
    },
    
    checkAndTrigger: function(timeThreshold, isMovementTrigger = false) {
        // Nie uruchamiaj jeśli już nagrywamy
        if (isRecording) return;
        
        const now = Date.now();
        const lastEntry = addresses[0]; // Najnowszy wpis (zakładamy unshift)
        
        // Jeśli brak wpisów, to triggerujemy (pierwszy start)
        let shouldTrigger = false;
        
        if (!lastEntry) {
            shouldTrigger = true;
        } else {
            const timeDiff = now - lastEntry.id; // id to timestamp
            if (timeDiff > timeThreshold) {
                shouldTrigger = true;
            }
        }
        
        if (shouldTrigger) {
            console.log(`CarAssistant: Triggering sequence (Reason: ${isMovementTrigger ? 'Movement' : 'Engine Start'})`);
            this.triggerSequence();
        }
    },
    
    triggerSequence: function() {
        this.lastTriggerTime = Date.now();
        
        // a) Synteza mowy "Dodaj adres"
        if ('speechSynthesis' in window) {
            // Anuluj poprzednie
            window.speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance("Dodaj adres");
            utterance.lang = 'pl-PL';
            utterance.rate = 0.88; // Zmieniono z 1.1 na 0.88 dla lepszego zrozumienia
            utterance.pitch = 1.0;
            
            utterance.onend = () => {
                // b) Po zakończeniu mowy uruchom mikrofon
                // c) Pulsowanie jest obsługiwane przez toggleRecognition (klasa pulse-red)
                window.toggleRecognition();
            };
            
            utterance.onerror = (e) => {
                console.error('Speech synthesis error:', e);
                // Fallback w razie błędu
                window.toggleRecognition();
            };
            
            window.speechSynthesis.speak(utterance);
        } else {
            // Fallback jeśli brak syntezy
            window.toggleRecognition();
        }
    }
};

// --- SMART ASSISTANT (INTELIGENTNY ASYSTENT TRASY) ---
window.closeSuggestion = () => {
    document.getElementById('suggestionCard').classList.add('hidden');
    if (window.SmartAssistant) window.SmartAssistant.isSpoken = false; // Reset spoken state on manual close
};

window.useCurrentGpsForCustomer = function() {
    if (!platform.hasGeolocation) {
        window.showToast("Brak modułu GPS", "map-pin-off", "text-red-500");
        return;
    }
    
    const btn = document.getElementById('btnGpsCustomer');
    if(btn) btn.classList.add('animate-pulse');
    window.showToast("Pobieranie pozycji...", "loader", "text-blue-500");
    
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if(btn) btn.classList.remove('animate-pulse');
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            
            if (customerMap) {
                customerMap.setView([lat, lng], 18);
                if (customerMarker) customerMap.removeLayer(customerMarker);
                customerMarker = L.marker([lat, lng], { draggable: true }).addTo(customerMap);
                window.showToast("Zaktualizowano pozycję", "map-pin", "text-green-500");
            }
        },
        (err) => {
             if(btn) btn.classList.remove('animate-pulse');
             console.error(err);
             window.showToast("Błąd GPS", "alert-circle", "text-red-500");
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
};

window.SmartAssistant = {
    active: false,
    watchId: null,
    intervalId: null,
    proximityRadius: 40,
    lastSuggestions: [],
    isSpoken: false,
    lastPosition: null,
    isMinimized: false,
    expandedIndex: null,

    init: function() {
        if (config.smartAssistantEnabled) {
            this.proximityRadius = config.proximityRadius || 40;
            this.start();
        }
    },

    setActive: function(enabled) {
        if (enabled) {
            this.proximityRadius = config.proximityRadius || 40;
            this.start();
        } else {
            this.stop();
        }
    },

    start: function() {
        if (this.active) return;
        this.active = true;
        console.log('SmartAssistant: Starting...');
        
        this.intervalId = setInterval(() => this.checkProximity(), 2000);
        
        if (platform.hasGeolocation) {
             this.watchId = navigator.geolocation.watchPosition(
                (pos) => { this.lastPosition = pos; },
                (err) => console.log('SmartAssistant GPS error:', err),
                { enableHighAccuracy: true, maximumAge: 0 }
            );
        }
        window.showToast("Inteligentny Asystent włączony", "brain-circuit", "text-blue-500");
    },

    stop: function() {
        if (!this.active) return;
        this.active = false;
        if (this.intervalId) clearInterval(this.intervalId);
        if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
        this.hideSuggestion();
        window.showToast("Inteligentny Asystent wyłączony", "brain-circuit", "text-gray-500");
    },

    checkProximity: function() {
        if (!this.lastPosition || !this.active) return;
        this.processProximity(this.lastPosition);
    },

    processProximity: function(pos) {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speed = pos.coords.speed || 0; // m/s
        
        let matches = [];
        customers.forEach(c => {
            if (c.lat && c.lng) {
                const dist = this.calculateDistance(lat, lng, c.lat, c.lng);
                if (dist <= this.proximityRadius) {
                    matches.push({ customer: c, dist: dist });
                }
            }
        });

        matches.sort((a, b) => a.dist - b.dist);

        // Voice Assistant Logic
        if (matches.length > 0) {
            const closest = matches[0];
            // Reset spoken flag if we moved away (> 30m)
            if (closest.dist > 30) {
                this.isSpoken = false;
            }
            
            // Speak if close (< 20m), stopped (< 1m/s), and not spoken yet
            if (closest.dist <= 20 && speed < 1.0 && !this.isSpoken) {
                this.speakAnnouncement(closest.customer);
                this.isSpoken = true;
            }
        }

        if (matches.length > 0) {
            this.showSuggestions(matches);
        } else {
            this.hideSuggestion();
        }
    },

    speakAnnouncement: function(customer) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        
        const noteText = customer.static_note ? `. Kod to ${customer.static_note}` : '';
        const formattedAddress = window.formatAddressForSpeech(customer.address || "");
        const msg = formattedAddress
            ? `Jesteś u ${customer.name} przy adresie ${formattedAddress}${noteText}`
            : `Jesteś u ${customer.name}${noteText}`;
        
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.lang = 'pl-PL';
        utterance.rate = 0.88;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
    },

    calculateDistance: function(lat1, lon1, lat2, lon2) {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    showSuggestions: function(matches) {
        const card = document.getElementById('suggestionCard');
        if (!card) return;
        
        this.lastSuggestions = matches;
        card.classList.remove('hidden');

        // Minimized View
        if (this.isMinimized) {
            card.innerHTML = `
                <div onclick="window.SmartAssistant.maximize()" class="flex justify-between items-center cursor-pointer p-1">
                    <div class="flex items-center gap-2">
                        <span class="relative flex h-3 w-3">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                        </span>
                        <span class="text-xs font-bold text-blue-600 dark:text-blue-400">Sugestie (${matches.length})</span>
                    </div>
                    <i data-lucide="chevron-up" class="w-4 h-4 text-gray-400"></i>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        // Full View
        if (matches.length === 1) {
            const match = matches[0];
            const customer = match.customer;
            const dist = match.dist;
            
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="text-[10px] font-black uppercase text-blue-500 tracking-wider">Sugestia Asystenta</span>
                        <h3 class="text-lg font-black text-gray-800 dark:text-gray-100 leading-tight">${customer.address}</h3>
                        <p class="text-sm font-medium text-gray-600 dark:text-gray-400">${customer.name} (${Math.round(dist)}m)</p>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="window.SmartAssistant.minimize()" class="p-1 opacity-50 hover:opacity-100"><i data-lucide="minus" class="w-4 h-4"></i></button>
                        <button onclick="window.closeSuggestion()" class="p-1 opacity-50 hover:opacity-100"><i data-lucide="x" class="w-4 h-4"></i></button>
                    </div>
                </div>
                ${customer.static_note ? `
                <div class="bg-white dark:bg-zinc-900/50 p-2 rounded-lg mb-3 border border-blue-100 dark:border-blue-800/30">
                    <p class="text-xs font-mono text-blue-600 dark:text-blue-300">${customer.static_note}</p>
                </div>` : ''}
                <div class="flex gap-2">
                    <a href="${customer.phone ? 'tel:' + customer.phone : '#'}" class="flex-none w-12 h-12 flex items-center justify-center bg-green-500 ${!customer.phone ? 'opacity-50 pointer-events-none' : ''} text-white rounded-xl shadow-sm active:scale-95 transition-all">
                        <i data-lucide="phone" class="w-5 h-5"></i>
                    </a>
                    <button onclick="window.SmartAssistant.confirmStop('${customer.address.replace(/'/g, "\\'")}')" class="flex-1 bg-blue-500 text-white rounded-xl font-black uppercase text-xs shadow-sm shadow-blue-500/30 active:scale-95 transition-all flex items-center justify-center gap-2">
                        <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                        Potwierdź Stop
                    </button>
                </div>
            `;
        } else {
            card.innerHTML = `
                <div class="flex justify-between items-center mb-3">
                    <span class="text-[10px] font-black uppercase text-blue-500 tracking-wider">Sugestie (${matches.length})</span>
                    <div class="flex gap-1">
                        <button onclick="window.SmartAssistant.minimize()" class="p-1 opacity-50 hover:opacity-100"><i data-lucide="minus" class="w-4 h-4"></i></button>
                        <button onclick="window.closeSuggestion()" class="p-1 opacity-50 hover:opacity-100"><i data-lucide="x" class="w-4 h-4"></i></button>
                    </div>
                </div>
                <div class="space-y-2 max-h-60 overflow-y-auto">
                    ${matches.map((m, idx) => `
                        <div class="bg-white dark:bg-zinc-900/50 rounded-lg border border-blue-100 dark:border-blue-900/30 overflow-hidden">
                            <div onclick="window.SmartAssistant.toggleExpand(${idx})" class="p-3 flex justify-between items-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors">
                                <div>
                                    <p class="font-bold text-sm leading-tight">${m.customer.address}</p>
                                    <p class="text-[10px] text-gray-500">${Math.round(m.dist)}m • ${m.customer.name}</p>
                                </div>
                                <i data-lucide="chevron-down" id="chevron-${idx}" class="w-4 h-4 text-blue-400 transition-transform ${this.expandedIndex === idx ? 'rotate-180' : ''}"></i>
                            </div>
                            <div id="details-${idx}" class="${this.expandedIndex === idx ? '' : 'hidden'} p-3 pt-0 border-t border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/5">
                                ${m.customer.static_note ? `<p class="text-xs font-mono text-blue-600 dark:text-blue-300 mb-3 mt-2">${m.customer.static_note}</p>` : ''}
                                <div class="flex gap-2 mt-2">
                                    <a href="${m.customer.phone ? 'tel:' + m.customer.phone : '#'}" class="flex-none w-10 h-10 flex items-center justify-center bg-green-500 ${!m.customer.phone ? 'opacity-50 pointer-events-none' : ''} text-white rounded-lg shadow-sm active:scale-95 transition-all">
                                        <i data-lucide="phone" class="w-4 h-4"></i>
                                    </a>
                                    <button onclick="window.SmartAssistant.confirmStop('${m.customer.address.replace(/'/g, "\\'")}')" class="flex-1 bg-blue-500 text-white rounded-lg font-black uppercase text-[10px] shadow-sm shadow-blue-500/30 active:scale-95 transition-all flex items-center justify-center gap-2">
                                        <i data-lucide="check-circle-2" class="w-3 h-3"></i>
                                        Potwierdź
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        lucide.createIcons();
    },
    
    toggleExpand: function(idx) {
        if (this.expandedIndex === idx) {
            this.expandedIndex = null;
        } else {
            this.expandedIndex = idx;
        }
        this.showSuggestions(this.lastSuggestions);
    },

    minimize: function() {
        this.isMinimized = true;
        this.showSuggestions(this.lastSuggestions);
    },

    maximize: function() {
        this.isMinimized = false;
        this.showSuggestions(this.lastSuggestions);
    },
    
    hideSuggestion: function() {
        const card = document.getElementById('suggestionCard');
        if (card && !card.classList.contains('hidden')) card.classList.add('hidden');
        this.lastSuggestions = [];
        this.expandedIndex = null;
    },
    
    confirmStop: function(address) {
        const customer = customers.find(c => c.address === address);
        if (customer) {
            window.addEntry(customer.address, customer.static_note, 'delivery', 0, true);
            this.hideSuggestion();
            this.isSpoken = true; 
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    // Inicjalizuj CarAssistant
    CarAssistant.init();
    // Inicjalizuj SmartAssistant
    SmartAssistant.init();
    WakeLockManager.init();
    if (window.initChargingIndicator) window.initChargingIndicator();
    if (window.initCityAutocomplete) window.initCityAutocomplete();

    document.getElementById('setAiEnabled').checked = config.aiEnabled !== false;
    document.getElementById('setGeminiKey').value = config.geminiKey || "";
    const providerSelect = document.getElementById('setAiProvider');
    if (providerSelect) providerSelect.value = config.aiProvider || "groq";
    document.getElementById('setCity').value = config.city || "";
    document.getElementById('setTheme').value = config.theme || "auto";
    document.getElementById('setStopWord').value = config.stopWord || "notatka";
    document.getElementById('setGpsEnabled').checked = config.gpsEnabled !== false;
    document.getElementById('setWakeLockEnabled').checked = config.wakeLockEnabled === true;
    document.getElementById('setCarAssistantEnabled').checked = config.carAssistantEnabled === true;
    document.getElementById('setVoiceConfirmationEnabled').checked = config.voiceConfirmationEnabled === true;
    document.getElementById('setSmartAssistantEnabled').checked = config.smartAssistantEnabled === true;
    document.getElementById('setProximityRadius').value = config.proximityRadius || 40;
    
    window.updateApiKeyPlaceholder();
    
    // Dodaj event listeners z debouncing
    document.getElementById('setGeminiKey').addEventListener('input', window.applySettings);
    document.getElementById('setCity').addEventListener('input', window.applySettings);
    document.getElementById('setStopWord').addEventListener('input', window.applySettings);
    document.getElementById('setSmartAssistantEnabled')?.addEventListener('change', window.applySettings);
    document.getElementById('setProximityRadius')?.addEventListener('input', window.applySettings);
    
    // Bind GPS Button in Customer Modal
    document.getElementById('btnGpsCustomer')?.addEventListener('click', window.useCurrentGpsForCustomer);
    
    let customerAddressDebounce = null;
    const custAddrInput = document.getElementById('custAddress');
    const custCityInput = document.getElementById('custCity');
    const triggerCustomerGeocode = () => {
        const addr = custAddrInput ? custAddrInput.value.trim() : "";
        if (!addr) return;
        const cityVal = custCityInput && custCityInput.value.trim()
            ? custCityInput.value.trim()
            : (config.city || "");
        if (customerAddressDebounce) clearTimeout(customerAddressDebounce);
        customerAddressDebounce = setTimeout(() => {
            window.geocodeAddress(addr, cityVal).then(coords => {
                if (coords && customerMap) {
                    customerMap.setView([coords.lat, coords.lng], 16);
                    if (customerMarker) customerMap.removeLayer(customerMarker);
                    customerMarker = L.marker([coords.lat, coords.lng], { draggable: true }).addTo(customerMap);
                }
            }).catch(e => console.error('Customer geocode error:', e));
        }, 600);
    };
    if (custAddrInput) {
        custAddrInput.addEventListener('input', triggerCustomerGeocode);
    }
    if (custCityInput) {
        custCityInput.addEventListener('input', triggerCustomerGeocode);
    }
    
    if (!config.city && navigator.geolocation) window.updateCityFromGps();
    if (config.wakeLockEnabled) window.toggleWakeLock(true);
    window.refreshTheme(); window.saveAndRender();
    setInterval(window.refreshTheme, 60000);
    
    // Platform-specific UI adjustments
    if (platform.isIOS) {
        // Na iOS ukryj Wake Lock status (nie działa)
        const wakeStatusBox = document.getElementById('wakeStatusBox');
        if (wakeStatusBox) wakeStatusBox.style.display = 'none';
    }
    
    if (platform.isDesktop) {
        // Na desktop dodaj informację o keyboard shortcuts
        document.body.setAttribute('data-platform', 'desktop');
    } else {
        document.body.setAttribute('data-platform', 'mobile');
    }
    
    // Pokaż ostrzeżenie o file:// jeśli aplikacja działa na file://
    const fileProtocolWarning = document.getElementById('fileProtocolWarning');
    if (fileProtocolWarning && platform.isFileProtocol) {
        fileProtocolWarning.style.display = 'block';
    }
    
    // Inicjalizuj ikony Lucide dla przycisków w ustawieniach
    lucide.createIcons();
    
    // Informacja o platformie w konsoli (dla debugowania)
    console.log('Platform detected:', {
        isIOS: platform.isIOS,
        isAndroid: platform.isAndroid,
        isMobile: platform.isMobile,
        isDesktop: platform.isDesktop,
        hasWakeLock: platform.hasWakeLock,
        hasVibration: platform.hasVibration,
        hasSpeechRecognition: platform.hasSpeechRecognition,
        isHTTPS: platform.isHTTPS
    });
    
    // Enter key support w modalach
    document.getElementById('editAddrInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('editNoteInput')?.focus();
    });
    document.getElementById('editNoteInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) window.saveEdit();
    });
    document.getElementById('tipInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') window.confirmTip();
    });
    const myAreaInput = document.getElementById('myAreaInput');
    if (myAreaInput) {
        myAreaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') window.addMyAreaStreet();
        });
    }
    window.renderMyAreaStreets();
});
