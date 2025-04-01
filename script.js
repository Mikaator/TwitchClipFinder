// Twitch OAuth2 Konfiguration
const TWITCH_CLIENT_ID = '5ocmdhr1rwu262aewefy4gz67etzjt';
const REDIRECT_URI = 'https://mikaator.github.io/TwitchClipFinder/';
const SCOPES = ['clips:edit', 'user:read:email'];

// Globale Variablen für Clip-Management
let allClips = [];
let displayedClips = [];
let totalClips = 0;
const DISPLAY_BATCH_SIZE = 200;

// Globale Variable für den aktuellen Suchvorgang
let currentSearch = null;

// Theme Switcher
const themeToggle = document.getElementById('theme-toggle');

// Prüfe gespeichertes Theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggle.checked = savedTheme === 'light';

// Theme Wechsel Handler
themeToggle.addEventListener('change', function(e) {
    // Erstelle Overlay für die Animation
    const overlay = document.createElement('div');
    overlay.className = 'theme-transition-overlay';
    document.body.appendChild(overlay);

    // Setze die Klickposition als Startpunkt
    const rect = e.target.getBoundingClientRect();
    const clickX = e.clientX || rect.left + rect.width / 2;
    const clickY = e.clientY || rect.top + rect.height / 2;
    
    document.documentElement.style.setProperty('--click-x', clickX + 'px');
    document.documentElement.style.setProperty('--click-y', clickY + 'px');
    
    // Setze die Zielfarbe basierend auf dem gewählten Theme
    const targetBackground = this.checked ? '#f7f7f9' : '#0e0e10';
    document.documentElement.style.setProperty('--target-background', targetBackground);

    // Starte die Animation
    requestAnimationFrame(() => {
        overlay.classList.add('active');
        
        // Ändere das Theme
        if (this.checked) {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        }

        // Entferne das Overlay nach der Animation
        setTimeout(() => {
            overlay.remove();
        }, 1000);
    });
});

// Füge diese Variable am Anfang der Datei hinzu
let hasSearchedBefore = false;
let accessToken = null;

// Twitch OAuth2 Login
function loginWithTwitch() {
    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=${SCOPES.join(' ')}`;
    window.location.href = authUrl;
}

// OAuth2 Callback Handler
function handleOAuthCallback() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    
    if (token) {
        accessToken = token;
        localStorage.setItem('twitch_token', token);
        window.location.hash = '';
        checkAuthStatus();
    }
}

// Auth Status überprüfen
function checkAuthStatus() {
    const token = localStorage.getItem('twitch_token');
    if (token) {
        accessToken = token;
        document.querySelector('.login-container').style.display = 'none';
        document.querySelector('.search-form').style.display = 'block';
    } else {
        document.querySelector('.login-container').style.display = 'block';
        document.querySelector('.search-form').style.display = 'none';
    }
}

// Logout Funktion
function logout() {
    localStorage.removeItem('twitch_token');
    accessToken = null;
    checkAuthStatus();
}

// Twitch API Aufruf
async function callTwitchAPI(endpoint, options = {}) {
    if (!accessToken) {
        throw new Error('Nicht authentifiziert');
    }

    const response = await fetch(`https://api.twitch.tv/helix/${endpoint}`, {
        ...options,
        headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`,
            ...options.headers
        }
    });

    if (!response.ok) {
        if (response.status === 401) {
            // Token ungültig, Logout durchführen
            logout();
            throw new Error('Session abgelaufen. Bitte erneut einloggen.');
        }
        throw new Error(`API Fehler: ${response.status}`);
    }

    return response.json();
}

// Clip Suche
async function searchClips() {
    if (!accessToken) {
        alert('Bitte melden Sie sich zuerst an');
        return;
    }

    if (currentSearch || hasSearchedBefore) {
        const notification = document.createElement('div');
        notification.className = 'restart-notification';
        notification.innerHTML = `
            <i class="fas fa-sync-alt"></i>
            Clipsuche wird neu gestartet
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3500);
    }

    hasSearchedBefore = true;

    if (currentSearch) {
        currentSearch.abort();
        stopWaitMessageRotation(document.querySelector('.wait-message'));
    }

    const oldSearch = document.querySelector('.clip-search');
    if (oldSearch) oldSearch.remove();

    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    const channel = document.getElementById('channelName').value;
    if (!channel) {
        alert('Bitte gib einen Kanalnamen ein');
        return;
    }

    const loader = document.getElementById('loader');
    const loaderText = document.querySelector('.loader-text');
    
    try {
        loader.style.display = 'block';
        resultsDiv.style.display = 'none';
        allClips = [];
        displayedClips = [];
        totalClips = 0;
        loaderText.textContent = 'Suche Clips...';

        const messageElement = startWaitMessageRotation();

        const query = document.getElementById('searchQuery').value;
        const searchType = document.getElementById('searchType').value;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;

        // Hole User ID
        const userData = await callTwitchAPI(`users?login=${channel}`);
        if (!userData.data || userData.data.length === 0) {
            throw new Error(`Kanal ${channel} nicht gefunden`);
        }
        const broadcasterId = userData.data[0].id;

        // Suche Clips mit Paginierung
        let allClipsTemp = [];
        let cursor = null;
        
        do {
            const queryParams = `broadcaster_id=${broadcasterId}&first=100${
                startDate ? `&started_at=${startDate}T00:00:00Z` : ''
            }${
                endDate ? `&ended_at=${endDate}T23:59:59Z` : ''
            }${
                cursor ? `&after=${cursor}` : ''
            }`;
            
            const clipsResponse = await callTwitchAPI(`clips?${queryParams}`);
            
            if (clipsResponse.data && clipsResponse.data.length > 0) {
                allClipsTemp = [...allClipsTemp, ...clipsResponse.data];
                cursor = clipsResponse.pagination.cursor;
                // Aktualisiere den Ladetext
                loaderText.textContent = `Lade Clips... (${allClipsTemp.length} gefunden)`;
            } else {
                break;
            }
        } while (cursor);

        let clips = allClipsTemp;

        // Filtere nach Suchkriterien
        if (query) {
            clips = clips.filter(clip => {
                if (searchType === 'title') {
                    return clip.title.toLowerCase().includes(query.toLowerCase());
                } else {
                    return clip.creator_name.toLowerCase().includes(query.toLowerCase());
                }
            });
        }

        // Filtere nach Datum
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            clips = clips.filter(clip => {
                const clipDate = new Date(clip.created_at);
                return clipDate >= start && clipDate <= end;
            });
        }

        // Sortiere Clips
        const sortBy = document.getElementById('sortBy').value;
        clips = sortClips(clips, sortBy);

        allClips = clips;
        totalClips = clips.length;
        updateResults();

        currentSearch = null;
        stopWaitMessageRotation(messageElement);
        loader.style.display = 'none';
        resultsDiv.style.display = 'grid';
        
        if (allClips.length === 0) {
            resultsDiv.innerHTML = '<div class="no-results">Keine Clips gefunden</div>';
        }
        
    } catch (error) {
        console.error('Fehler bei der Suche:', error);
        alert(error.message);
        stopWaitMessageRotation(messageElement);
    } finally {
        currentSearch = null;
        stopWaitMessageRotation(messageElement);
        loader.style.display = 'none';
        resultsDiv.style.display = 'grid';
    }
}

// Funktion zum Erstellen der Clip-Suche
function createClipSearch() {
    const searchContainer = document.createElement('div');
    searchContainer.className = 'clip-search';
    searchContainer.innerHTML = `
        <div class="clip-search-input">
            <i class="fas fa-search"></i>
            <input type="text" placeholder="In gefundenen Clips suchen..." id="clipSearchInput">
        </div>
    `;
    document.getElementById('results').insertAdjacentElement('beforebegin', searchContainer);

    // Event-Listener für die Suche
    const searchInput = searchContainer.querySelector('#clipSearchInput');
    searchInput.addEventListener('input', filterClips);
}

// Funktion zum Filtern der Clips
function filterClips(e) {
    const searchTerm = e.target.value.toLowerCase();
    const clipCards = document.querySelectorAll('.clip-card');
    
    clipCards.forEach(card => {
        const title = card.querySelector('h3').textContent.toLowerCase();
        const creator = card.querySelector('.fa-video').parentElement.textContent.toLowerCase();
        const matches = title.includes(searchTerm) || creator.includes(searchTerm);
        card.style.display = matches ? 'block' : 'none';
    });
}

// Modifiziere updateResults (entferne Counter)
function updateResults() {
    // Entferne alte Suchleiste, falls vorhanden
    const oldSearch = document.querySelector('.clip-search');
    if (oldSearch) {
        oldSearch.remove();
    }

    // Entferne Duplikate aus den verbleibenden Clips
    const remainingClips = allClips.filter(clip => 
        !displayedClips.some(displayedClip => displayedClip.id === clip.id)
    );

    const nextBatch = remainingClips.slice(0, DISPLAY_BATCH_SIZE);
    
    if (nextBatch.length > 0) {
        displayedClips.push(...nextBatch);
        const startIndex = displayedClips.length - nextBatch.length;
        displayNewClips(nextBatch, startIndex);
        
        if (displayedClips.length === nextBatch.length) {
            createClipSearch();
        }
        
        if (displayedClips.length < allClips.length) {
            showLoadMoreButton();
        } else {
            hideLoadMoreButton();
        }
    }
}

function showLoadMoreButton() {
    if (displayedClips.length < allClips.length) {
        const loadMoreButton = document.getElementById('load-more') || createLoadMoreButton();
        loadMoreButton.style.display = 'block';
    }
}

function createLoadMoreButton() {
    const button = document.createElement('button');
    button.id = 'load-more';
    button.className = 'load-more-button';
    button.textContent = 'Weitere Clips laden';
    button.onclick = updateResults;
    document.getElementById('results').insertAdjacentElement('afterend', button);
    return button;
}

function hideLoadMoreButton() {
    const button = document.getElementById('load-more');
    if (button) {
        button.style.display = 'none';
    }
}

// Event-Listener für Sortierung
document.getElementById('sortBy').addEventListener('change', function() {
    if (allClips.length > 0) {
        // Entferne Duplikate basierend auf der Clip-ID
        const uniqueClips = [...new Map(allClips.map(clip => [clip.id, clip])).values()];
        
        // Sortiere die eindeutigen Clips
        const sortedClips = sortClips(uniqueClips, this.value);
        
        // Aktualisiere die globalen Arrays
        allClips = sortedClips;
        displayedClips = [];
        
        // Setze die Anzeige zurück
        const resultsDiv = document.getElementById('results');
        resultsDiv.innerHTML = '';
        
        // Entferne den alten "Mehr laden" Button falls vorhanden
        const oldButton = document.getElementById('load-more');
        if (oldButton) {
            oldButton.remove();
        }
        
        // Zeige die ersten Clips in der neuen Sortierung
        updateResults();
    }
});

function sortClips(clips, sortBy) {
    return [...clips].sort((a, b) => {
        switch (sortBy) {
            case 'date_desc':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'date_asc':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'views_desc':
                return b.view_count - a.view_count;
            case 'views_asc':
                return a.view_count - b.view_count;
            default:
                return 0;
        }
    });
}

function displayNewClips(clips, startIndex) {
    const resultsDiv = document.getElementById('results');
    
    clips.forEach((clip, index) => {
        const clipCard = document.createElement('div');
        clipCard.className = 'clip-card';
        clipCard.style.animationDelay = `${(startIndex + index) * 0.05}s`;
        
        // Bereinige den Titel von Emojis und Sonderzeichen für den Dateinamen
        const sanitizedTitle = clip.title
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // Entferne Emojis
            .replace(/[<>:"/\\|?*]/g, '')                    // Entferne unerlaubte Dateizeichen
            .trim();                                         // Entferne Leerzeichen am Anfang/Ende
            
        const filename = `${sanitizedTitle}-${clip.broadcaster_name}-${clip.creator_name}-${new Date(clip.created_at).toISOString().split('T')[0]}`;
        
        clipCard.innerHTML = `
            <img src="${clip.thumbnail_url}" alt="${clip.title}">
            <div class="clip-card-content">
                <h3>${clip.title}</h3>
                <div class="clip-info">
                    <p><i class="fas fa-user"></i> ${clip.broadcaster_name}</p>
                    <p><i class="fas fa-video"></i> ${clip.creator_name}</p>
                    <p><i class="fas fa-eye"></i> ${clip.view_count.toLocaleString()} Views</p>
                    <p><i class="fas fa-calendar"></i> ${new Date(clip.created_at).toLocaleDateString('de-DE')}</p>
                </div>
                <div class="clip-actions">
                    <a href="${clip.url}" target="_blank" class="watch-button">
                        <i class="fas fa-play"></i> Clip ansehen
                    </a>
                    <button onclick="downloadClip('${clip.url}', '${filename}')" class="download-button">
                        <i class="fas fa-download"></i> Clip herunterladen
                    </button>
                </div>
            </div>
        `;
        resultsDiv.appendChild(clipCard);
    });
}

// Flatpickr Konfiguration
const dateConfig = {
    enableTime: false,
    dateFormat: "Y-m-d",
    locale: {
        firstDayOfWeek: 1,
        weekdays: {
            shorthand: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"],
            longhand: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]
        },
        months: {
            shorthand: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
            longhand: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
        }
    },
    theme: "dark",
    position: "below",
    animate: true,
    monthSelectorType: "static",
    nextArrow: '<i class="fas fa-chevron-right"></i>',
    prevArrow: '<i class="fas fa-chevron-left"></i>',
    altInput: true,
    altFormat: "d.m.Y",
    time_24hr: true,
    allowInput: true,
    disableMobile: true
}

// Initialisiere Flatpickr für beide Datums-Inputs
const startDatePicker = flatpickr("#startDate", {
    ...dateConfig,
    maxDate: document.getElementById('endDate').value || 'today',
    placeholder: "Von",
    onChange: function(selectedDates, dateStr) {
        if (selectedDates[0]) {
            endDatePicker.set('minDate', dateStr);
        }
    }
});

const endDatePicker = flatpickr("#endDate", {
    ...dateConfig,
    minDate: document.getElementById('startDate').value || '1970-01-01',
    maxDate: 'today',
    placeholder: "Bis",
    onChange: function(selectedDates, dateStr) {
        if (selectedDates[0]) {
            startDatePicker.set('maxDate', dateStr);
        }
    }
});

// Die openDatePicker Funktion anpassen
function openDatePicker(inputId) {
    document.getElementById(inputId)._flatpickr.open();
}

// Event-Listener für Kalender-Icons
document.querySelectorAll('.date-group i').forEach(icon => {
    icon.addEventListener('click', (e) => {
        e.stopPropagation(); // Verhindert doppeltes Öffnen
        const input = icon.parentElement.querySelector('input[type="date"]');
        input.showPicker();
    });
});

// Logo Click Handler
document.querySelector('.logo-link').addEventListener('click', function(e) {
    e.preventDefault();
    
    if (this.classList.contains('reloading')) return;
    
    this.classList.add('reloading');
    
    this.addEventListener('animationend', () => {
        this.classList.remove('reloading');
        window.location.reload();
    }, { once: true });
});

const waitMessages = [
    "Gute Clips lassen sich Zeit zum Finden...",
    "Je größer der Zeitraum, desto länger die Suche - aber es lohnt sich!",
    "Ein genauer Zeitraum beschleunigt die Suche erheblich",
    "Wir durchforsten gerade jeden Winkel nach den besten Clips",
    "Die Clips sind wie Sterne - manchmal braucht man Zeit, sie zu entdecken",
    "Qualität braucht Zeit - wir sind gleich fertig",
    "Keine Sorge, wir haben dich nicht vergessen",
    "Die besten Clips sind oft gut versteckt",
    "Wir geben unser Bestes, um deine Clips zu finden",
    "Ein kürzerer Zeitraum könnte die Suche beschleunigen",
    "Manchmal sind die wertvollsten Dinge schwer zu finden",
    "Wir durchsuchen jeden Clip sorgfältig für dich",
    "Die Suche läuft auf Hochtouren",
    "Große Zeiträume bedeuten viele Clips zum Durchsuchen",
    "Bleib dran, wir sind fast fertig",
    "Deine Clips sind es wert, darauf zu warten",
    "Wir sortieren gerade die besten Momente für dich",
    "Ein präziserer Zeitraum könnte schneller zum Ziel führen",
    "Die Suche ist wie ein guter Stream - manchmal braucht es etwas Geduld",
    "Keine Sorge, wir arbeiten hart im Hintergrund",
    "Qualität braucht eben seine Zeit",
    "Wir sammeln gerade die Highlights für dich",
    "Je mehr Clips, desto länger die Suche - aber auch desto mehr Auswahl",
    "Gleich haben wir's geschafft!",
    "Die besten Clips sind das Warten wert"
];

let messageInterval;
let currentMessageIndex = 0;

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function startWaitMessageRotation() {
    // Entferne alte Wartebotschaften
    const oldMessages = document.querySelectorAll('.wait-message');
    oldMessages.forEach(msg => msg.remove());

    const loaderText = document.querySelector('.loader-text');
    const messageElement = document.createElement('div');
    messageElement.className = 'wait-message';
    messageElement.style.opacity = '0';
    
    // Füge die Nachricht NACH dem Ladebalken ein
    loaderText.parentElement.appendChild(messageElement);

    // Mische die Nachrichten
    const shuffledMessages = shuffleArray([...waitMessages]);
    currentMessageIndex = 0;

    // Erste Nachricht nach 15 Sekunden (statt 20)
    setTimeout(() => {
        messageElement.classList.add('visible');
        messageElement.style.opacity = '1';
        messageElement.textContent = shuffledMessages[0];
        
        // Weitere Nachrichten alle 17 Sekunden (statt 20)
        messageInterval = setInterval(() => {
            currentMessageIndex = (currentMessageIndex + 1) % shuffledMessages.length;
            messageElement.style.opacity = '0';
            setTimeout(() => {
                messageElement.textContent = shuffledMessages[currentMessageIndex];
                messageElement.style.opacity = '1';
            }, 500);
        }, 17000);  // 17 Sekunden
    }, 15000);  // 15 Sekunden

    return messageElement;
}

function stopWaitMessageRotation(messageElement) {
    clearInterval(messageInterval);
    if (messageElement) {
        messageElement.remove();
    }
    currentMessageIndex = 0;
}

// Clip Download
async function downloadClip(clipUrl, filename) {
    try {
        if (!clipUrl) {
            throw new Error('Keine Clip-URL vorhanden');
        }

        // Extrahiere Clip-ID
        const clipId = clipUrl.split('/')[-1].split('?')[0];

        // Hole Clip-Details
        const clipData = await callTwitchAPI(`clips?id=${clipId}`);
        if (!clipData.data || clipData.data.length === 0) {
            throw new Error('Clip nicht gefunden');
        }

        const clip = clipData.data[0];
        const videoUrl = clip.thumbnail_url.replace('-preview-480x272.jpg', '.mp4');

        // Download durchführen
        const response = await fetch(videoUrl);
        if (!response.ok) throw new Error('Download fehlgeschlagen');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename + '.mp4';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

    } catch (error) {
        console.error('Download Error:', error);
        alert(error.message);
    }
}

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
    handleOAuthCallback();
    checkAuthStatus();
}); 