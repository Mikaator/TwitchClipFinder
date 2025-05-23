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

        // Suche Clips mit verbesserter Paginierung und automatischer Aufteilung des Zeitraums
        await searchClipsForTimeRange(broadcasterId, startDate, endDate, query, searchType);

        console.log(`Insgesamt ${allClips.length} Clips geladen`);

        // Sortiere Clips
        const sortBy = document.getElementById('sortBy').value;
        // Entferne Duplikate basierend auf der Clip-ID
        allClips = [...new Map(allClips.map(clip => [clip.id, clip])).values()];
        allClips = sortClips(allClips, sortBy);
        console.log(`Clips nach ${sortBy} sortiert`);

        totalClips = allClips.length;
        console.log(`Finale Anzahl der Clips: ${totalClips}`);
        
        // Setze die Anzeige zurück
        resultsDiv.innerHTML = '';
        displayedClips = [];
        
        // Zeige alle Clips auf einmal an
        displayNewClips(allClips, 0);

        // Erstelle Suchleiste
        createClipSearch();

        currentSearch = null;
        if (messageElement) {
            stopWaitMessageRotation(messageElement);
        }
        loader.style.display = 'none';
        resultsDiv.style.display = 'grid';
        
        // Prüfe, ob Clips vorhanden sind
        if (allClips.length === 0) {
            console.log('Keine Clips gefunden, zeige Meldung');
            resultsDiv.innerHTML = '<div class="no-results">Keine Clips gefunden</div>';
        } else {
            console.log(`${allClips.length} Clips werden angezeigt`);
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

// Neue Funktion zur Suche von Clips in einem bestimmten Zeitraum mit automatischer Aufteilung
async function searchClipsForTimeRange(broadcasterId, startDate, endDate, query, searchType) {
    let allClipsTemp = [];
    let cursor = null;
    let attempts = 0;
    let consecutiveErrors = 0;
    const loaderText = document.querySelector('.loader-text');
    
    // Fortschrittsanzeige-Elemente
    const timeProgressFill = document.querySelector('.time-progress-fill');
    const timeProgressPercentage = document.querySelector('.time-progress-percentage');
    
    // Ursprünglicher Start- und Endzeitpunkt
    let currentStartDate = startDate ? new Date(`${startDate}T00:00:00Z`) : new Date(0); // Standardmäßig Unix Epoch
    let currentEndDate = endDate ? new Date(`${endDate}T23:59:59Z`) : new Date(); // Standardmäßig jetzt
    
    // Berechne Gesamtzeitraum in Millisekunden für Fortschrittsanzeige
    const totalTimeRange = currentEndDate.getTime() - currentStartDate.getTime();
    
    // Wenn wir keinen Zeitraum haben, nur einen Durchlauf
    if (!startDate && !endDate) {
        // Setze Fortschritt auf 100%
        updateTimeProgress(100);
        allClipsTemp = await fetchClipsWithPagination(broadcasterId, null, null);
        allClips = [...allClips, ...allClipsTemp];
        return;
    }
    
    // Recursive function to handle dynamic time range splitting
    async function processTimeRange(startDate, endDate, segmentDays = 30) {
        // Berechne das Ende dieses Segments
        let segmentEndDate = new Date(startDate);
        segmentEndDate.setDate(segmentEndDate.getDate() + segmentDays);
        
        // Stelle sicher, dass wir nicht über das ursprüngliche Enddatum hinausgehen
        if (segmentEndDate > endDate) {
            segmentEndDate = new Date(endDate);
        }
        
        const formattedStartDate = startDate.toISOString().split('T')[0];
        const formattedEndDate = segmentEndDate.toISOString().split('T')[0];
        
        // Aktualisiere Fortschritt basierend auf bereits durchsuchtem Zeitraum
        const searchedTimeRange = startDate.getTime() - currentStartDate.getTime();
        const progress = Math.min(100, Math.round((searchedTimeRange / totalTimeRange) * 100));
        updateTimeProgress(progress);
        
        loaderText.textContent = `Lade Clips... (${allClips.length} gefunden, Zeitraum: ${formattedStartDate} bis ${formattedEndDate})`;
        console.log(`Suche Clips von ${formattedStartDate} bis ${formattedEndDate} (Segmentgröße: ${segmentDays} Tage)`);
        
        // Hole Clips für diesen Zeitraum und erhalte die bereits gefilterten Clips zurück
        const { filteredClips, totalClipsInSegment, reachedLimit } = 
            await fetchClipsWithPagination(broadcasterId, formattedStartDate, formattedEndDate);
        
        // Füge nur die gefilterten Clips zum Gesamtergebnis hinzu
        allClips = [...allClips, ...filteredClips];
        
        // Wenn wir das Limit erreicht haben und der Zeitraum größer als 1 Tag ist,
        // teilen wir den Zeitraum weiter auf
        if (reachedLimit && segmentDays > 1) {
            console.log(`Mehr als 1000 Clips im Zeitraum gefunden, teile in kleinere Segmente auf`);
            
            // Segment verkleinern
            const newSegmentDays = Math.max(1, Math.floor(segmentDays / 2));
            
            // Aktuelles Segment noch einmal mit kleinerer Segmentgröße verarbeiten
            await processTimeRange(startDate, segmentEndDate, newSegmentDays);
        } 
        // Wenn wir das Ende nicht erreicht haben, fahren wir mit dem nächsten Segment fort
        else if (segmentEndDate < endDate) {
            // Nächstes Segment beginnt einen Tag nach dem aktuellen Ende
            const nextStartDate = new Date(segmentEndDate);
            nextStartDate.setDate(nextStartDate.getDate() + 1);
            
            // Aktualisiere Fortschritt mit dem abgeschlossenen Segment
            const segmentTimeRange = segmentEndDate.getTime() - currentStartDate.getTime();
            const segmentProgress = Math.min(100, Math.round((segmentTimeRange / totalTimeRange) * 100));
            updateTimeProgress(segmentProgress);
            
            // Wenn wir das Limit erreicht haben, verkleinern wir künftige Segmente vorsorglich
            const nextSegmentDays = reachedLimit ? Math.max(1, Math.floor(segmentDays / 2)) : segmentDays;
            
            // Rekursiv zum nächsten Segment
            await processTimeRange(nextStartDate, endDate, nextSegmentDays);
        } else {
            // Wenn wir fertig sind, setze den Fortschritt auf 100%
            updateTimeProgress(100);
        }
        
        console.log(`Zwischenstand: ${allClips.length} Clips insgesamt gefunden`);
    }
    
    // Funktion zum Aktualisieren der Fortschrittsanzeige
    function updateTimeProgress(percentage) {
        timeProgressFill.style.width = `${percentage}%`;
        timeProgressPercentage.textContent = `${percentage}%`;
    }
    
    // Initialisiere Fortschrittsanzeige
    updateTimeProgress(0);
    
    // Starte die rekursive Verarbeitung mit initialer Segmentgröße von 30 Tagen
    await processTimeRange(currentStartDate, currentEndDate, 30);
    
    // Hilfsfunktion für Pagination innerhalb eines Zeitraums
    async function fetchClipsWithPagination(broadcasterId, startDate, endDate) {
        let filteredClipsForRange = [];
        let allClipsTemp = [];
        cursor = null;
        attempts = 0;
        consecutiveErrors = 0;
        let reachedLimit = false;
        
        do {
            const queryParams = new URLSearchParams({
                broadcaster_id: broadcasterId,
                first: '100'
            });

            if (startDate) {
                queryParams.append('started_at', `${startDate}T00:00:00Z`);
            }
            if (endDate) {
                queryParams.append('ended_at', `${endDate}T23:59:59Z`);
            }
            if (cursor) {
                queryParams.append('after', cursor);
            }
            
            try {
                // Längere Pause vor jeder Anfrage, besonders wenn es viele Clips gibt
                const pauseTime = allClipsTemp.length > 500 ? 1000 : 500;
                await new Promise(resolve => setTimeout(resolve, pauseTime));
                
                // Setze längeren Timeout für die API-Anfrage (15 Sekunden)
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                
                // Überprüfe, ob wir das Limit erreicht haben
                if (allClipsTemp.length >= 990) {
                    console.log(`DEBUG: Wir haben ${allClipsTemp.length} Clips gefunden. Cursor: ${cursor || 'kein Cursor'}`);
                    reachedLimit = true;
                    
                    // Bei sehr kurzen Zeiträumen (1 Tag) sammeln wir trotzdem bis zu 1000 Clips
                    if (startDate === endDate || !startDate || !endDate) {
                        console.log(`Zeitraum ist minimal oder nicht spezifiziert, sammle trotzdem bis zu 1000 Clips`);
                    } else {
                        console.log(`Limit von 1000 Clips erreicht. Zeitraum wird weiter aufgeteilt.`);
                        break;
                    }
                }
                
                console.log(`Sende Anfrage ${attempts + 1} mit Cursor: ${cursor || 'kein Cursor'}`);
                const clipsResponse = await callTwitchAPI(`clips?${queryParams.toString()}`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                attempts++;
                consecutiveErrors = 0; // Zurücksetzen bei erfolgreicher Anfrage
                
                if (clipsResponse.data && clipsResponse.data.length > 0) {
                    const newClips = clipsResponse.data;
                    
                    // Prüfe auf Duplikate in der aktuellen Antwort
                    const existingIds = new Set(allClipsTemp.map(c => c.id));
                    const uniqueNewClips = newClips.filter(clip => !existingIds.has(clip.id));
                    
                    allClipsTemp = [...allClipsTemp, ...uniqueNewClips];
                    cursor = clipsResponse.pagination?.cursor;
                    
                    loaderText.textContent = `Lade Clips... (${allClips.length + allClipsTemp.length} gefunden)`;
                    console.log(`Seite ${attempts}: ${uniqueNewClips.length} neue Clips geladen (${newClips.length} gesamt, ${allClipsTemp.length} in diesem Zeitraum, ${allClips.length + allClipsTemp.length} total)`);
                    
                    // Wenn alle Clips in dieser Antwort Duplikate waren und es keinen Cursor gibt, sind wir fertig
                    if (uniqueNewClips.length === 0 && !cursor) {
                        console.log('Keine neuen einzigartigen Clips mehr gefunden, Suche abgeschlossen');
                        break;
                    }
                } else {
                    console.log('Keine weiteren Clips gefunden');
                    break;
                }
                
                // WICHTIG: Explizite Überprüfung, ob ein Cursor existiert
                if (!cursor || cursor === '') {
                    console.log('Kein weiterer Cursor vorhanden, Suche abgeschlossen');
                    break;
                }
                
            } catch (error) {
                consecutiveErrors++;
                console.error(`Fehler beim Laden der Clips (Versuch ${attempts}):`, error);
                
                // Bei einem Fehler längere Pause einlegen und Wartezeit verdoppeln
                const errorPauseTime = 3000 * Math.min(consecutiveErrors, 3);
                console.log(`Warte ${errorPauseTime/1000} Sekunden vor dem nächsten Versuch...`);
                await new Promise(resolve => setTimeout(resolve, errorPauseTime));
                
                // Nach fünf aufeinanderfolgenden Fehlern abbrechen
                if (consecutiveErrors >= 5) {
                    console.error('Zu viele aufeinanderfolgende Fehler, Suche wird abgebrochen');
                    break;
                }
            }
        } while (cursor || consecutiveErrors > 0); // Entweder Cursor vorhanden oder es gab gerade einen Fehler

        console.log(`Insgesamt ${allClipsTemp.length} Clips geladen nach ${attempts} API-Anfragen für diesen Zeitraum`);

        // Filtere nach Suchkriterien
        if (query && query.trim() !== '') {
            filteredClipsForRange = allClipsTemp.filter(clip => {
                if (searchType === 'title') {
                    return clip.title.toLowerCase().includes(query.toLowerCase());
                } else {
                    return clip.creator_name.toLowerCase().includes(query.toLowerCase());
                }
            });
            console.log(`${filteredClipsForRange.length} von ${allClipsTemp.length} Clips nach Suchbegriff "${query}" gefiltert`);
        } else {
            console.log('Keine Suchkriterien aktiv');
            filteredClipsForRange = allClipsTemp; // Wenn kein Suchbegriff vorhanden ist, verwende alle Clips
        }
        
        return { 
            filteredClips: filteredClipsForRange, 
            totalClipsInSegment: allClipsTemp.length,
            reachedLimit: reachedLimit
        };
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
        
        // Zeige die ersten Clips in der neuen Sortierung
        displayNewClips(allClips, 0);
    }
});

// Verbesserte Filterfunktion
function filterClips(e) {
    const searchTerm = e.target.value.toLowerCase();
    const clipCards = document.querySelectorAll('.clip-card');
    
    // Wenn die Suchleiste leer ist, zeige alle Clips an
    if (!searchTerm) {
        clipCards.forEach(card => {
            card.style.display = 'block';
        });
        console.log('Suchleiste leer - zeige alle Clips an');
        return;
    }
    
    // Filtere die Clips basierend auf dem Suchbegriff
    let visibleCount = 0;
    clipCards.forEach(card => {
        const title = card.querySelector('h3').textContent.toLowerCase();
        const creator = card.querySelector('.fa-video').parentElement.textContent.toLowerCase();
        const matches = title.includes(searchTerm) || creator.includes(searchTerm);
        card.style.display = matches ? 'block' : 'none';
        if (matches) visibleCount++;
    });
    console.log(`${visibleCount} Clips nach Suche angezeigt`);
}

// Füge Scroll-Event-Listener hinzu
let isLoadingMore = false;

window.addEventListener('scroll', () => {
    // Prüfe, ob wir am Ende der Seite sind
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 1000) {
        // Verhindere mehrfaches Laden
        if (!isLoadingMore && displayedClips.length < allClips.length) {
            isLoadingMore = true;
            displayNewClips(allClips, displayedClips.length);
            // Setze den Lade-Status nach einer kurzen Verzögerung zurück
            setTimeout(() => {
                isLoadingMore = false;
            }, 500);
        }
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
    const existingClipIds = new Set(Array.from(resultsDiv.querySelectorAll('.clip-card')).map(card => card.dataset.clipId));
    
    clips.forEach((clip, index) => {
        // Prüfe, ob dieser Clip bereits angezeigt wird
        if (existingClipIds.has(clip.id)) {
            return; // Überspringe diesen Clip
        }
        
        const clipCard = document.createElement('div');
        clipCard.className = 'clip-card';
        clipCard.dataset.clipId = clip.id; // Speichere die Clip-ID für spätere Überprüfungen
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
                    <button class="download-button">
                        <i class="fas fa-download"></i> Clip herunterladen
                    </button>
                </div>
            </div>
        `;
        resultsDiv.appendChild(clipCard);
        
        // Event-Listener für den Download-Button, statt inline onclick
        const downloadButton = clipCard.querySelector('.download-button');
        downloadButton.addEventListener('click', async () => {
            // Speichere Original-Text des Buttons
            const originalButtonText = downloadButton.innerHTML;
            
            try {
                // Button-Status während des Downloads anzeigen
                downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wird heruntergeladen...';
                downloadButton.disabled = true;
                
                // Clip herunterladen
                await downloadClip(clip.url, filename);
                
                // Status nach erfolgreichem Download
                downloadButton.innerHTML = '<i class="fas fa-check"></i> Heruntergeladen';
                
                // Nach kurzer Zeit zurücksetzen
                setTimeout(() => {
                    downloadButton.innerHTML = originalButtonText;
                    downloadButton.disabled = false;
                }, 3000);
            } catch (error) {
                console.error('Fehler beim Herunterladen:', error);
                downloadButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Fehler';
                
                // Nach kurzer Zeit zurücksetzen
                setTimeout(() => {
                    downloadButton.innerHTML = originalButtonText;
                    downloadButton.disabled = false;
                }, 3000);
            }
        });
        
        // Ergänze die lokale Menge der angezeigten Clip-IDs
        existingClipIds.add(clip.id);
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
    if (!clipUrl) {
        throw new Error('Keine Clip-URL vorhanden');
    }

    // Extrahiere Clip-ID korrekt aus der URL
    const urlParts = clipUrl.split('/');
    const clipId = urlParts[urlParts.length - 1].split('?')[0];

    try {
        // Hole Clip-Details über die Twitch API
        const clipData = await callTwitchAPI(`clips?id=${clipId}`);
        if (!clipData.data || clipData.data.length === 0) {
            throw new Error('Clip nicht gefunden');
        }

        const clip = clipData.data[0];
        console.log('Clip-Details:', clip);
        
        // Zeige Lade-Animation auf dem Button an
        const downloadingPopup = document.createElement('div');
        downloadingPopup.style.position = 'fixed';
        downloadingPopup.style.top = '50%';
        downloadingPopup.style.left = '50%';
        downloadingPopup.style.transform = 'translate(-50%, -50%)';
        downloadingPopup.style.background = 'rgba(145, 71, 255, 0.9)';
        downloadingPopup.style.color = 'white';
        downloadingPopup.style.padding = '20px 30px';
        downloadingPopup.style.borderRadius = '10px';
        downloadingPopup.style.zIndex = '9999';
        downloadingPopup.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.5)';
        downloadingPopup.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right: 10px;"></i> Lade Clip herunter...';
        document.body.appendChild(downloadingPopup);
        
        // Wir verwenden einen kostenlosen CORS-Proxy-Dienst, um die CORS-Einschränkungen zu umgehen
        // Dieser erlaubt uns, die Twitch-Ressourcen direkt zu laden
        
        // Konstruiere die URLs für den Download
        // Wir probieren verschiedene Methoden, da sich Twitch-URLs ändern können
        // Hier generieren wir aus der Clip-ID die wahrscheinlichen Video-URLs
        
        // Extrahiere Informationen für die URL-Konstruktion
        const clipSlug = clipId.includes('-') ? clipId.split('-')[0] : clipId;
        
        // Definiere mögliche URL-Muster
        const possibleUrls = [
            // URL-Muster 1: Direkt aus der Thumbnail URL abgeleitet (wenn vorhanden)
            clip.thumbnail_url ? clip.thumbnail_url.replace('-preview-480x272.jpg', '.mp4') : null,
            
            // URL-Muster 2: Format von produktiven Assets
            `https://production.assets.clips.twitchcdn.net/${clipSlug}.mp4`,
            
            // URL-Muster 3: Alternatives Format
            `https://clips-media-assets2.twitch.tv/${clipSlug}.mp4`
        ].filter(url => url !== null);
        
        // CORS-Proxy wählen (wir verwenden mehrere Optionen für mehr Zuverlässigkeit)
        const corsProxies = [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
            'https://cors-anywhere.herokuapp.com/'
        ];
        
        // Versuche die Download-URLs der Reihe nach mit verschiedenen Proxies
        let downloadSuccess = false;
        let errorMessages = [];
        
        for (const corsProxy of corsProxies) {
            if (downloadSuccess) break;
            
            for (const url of possibleUrls) {
                try {
                    const proxyUrl = corsProxy + encodeURIComponent(url);
                    console.log(`Versuche Download über: ${proxyUrl}`);
                    
                    const response = await fetch(proxyUrl);
                    if (!response.ok) {
                        errorMessages.push(`Fehler bei ${url}: ${response.status} ${response.statusText}`);
                        continue;
                    }
                    
                    // Erfolgreicher Download
                    const blob = await response.blob();
                    
                    // Erzeugen des Download-Links
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = `${filename}.mp4`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(downloadUrl);
                    a.remove();
                    
                    downloadSuccess = true;
                    break;
                } catch (err) {
                    console.error(`Fehler beim Herunterladen von ${url}:`, err);
                    errorMessages.push(`Fehler bei ${url}: ${err.message}`);
                }
            }
        }
        
        // Entferne das Lade-Popup
        document.body.removeChild(downloadingPopup);
        
        if (!downloadSuccess) {
            // Wenn alle Methoden fehlschlagen, zeige einen Hinweis
            const errorMessage = `Es konnte kein direkter Download durchgeführt werden.\n\nBitte versuche manuell herunterzuladen von: ${clip.url}\n\nFehlerdetails: ${errorMessages.join(', ')}`;
            alert(errorMessage);
            console.error('Alle Download-Methoden fehlgeschlagen:', errorMessages);
            
            // Öffne den Clip direkt, damit der Benutzer ihn manuell herunterladen kann
            window.open(clip.url, '_blank');
            throw new Error('Direkter Download fehlgeschlagen');
        } else {
            return true;
        }
        
    } catch (error) {
        console.error('Download-Fehler:', error);
        alert(`Fehler beim Herunterladen des Clips: ${error.message}`);
        throw error;
    }
}

// Funktion zum Herunterladen aller Clips
async function downloadAllClips() {
    // Prüfen, ob Clips vorhanden sind
    if (!allClips || allClips.length === 0) {
        alert('Keine Clips zum Herunterladen vorhanden');
        return;
    }
    
    const button = document.querySelector('.bulk-download-button');
    const countDisplay = button.querySelector('.download-count');
    const progressRing = button.querySelector('circle');
    const cancelButton = document.querySelector('.cancel-download-button');
    
    // Download-Status setzen
    button.classList.add('downloading');
    cancelButton.style.display = 'block';
    let isCancelled = false;
    
    // Cancel-Button-Event
    cancelButton.addEventListener('click', () => {
        isCancelled = true;
        button.classList.remove('downloading');
        cancelButton.style.display = 'none';
    });
    
    // Downloads durchführen
    for (let i = 0; i < allClips.length; i++) {
        if (isCancelled) break;
        
        const clip = allClips[i];
        const sanitizedTitle = clip.title
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
            .replace(/[<>:"/\\|?*]/g, '')
            .trim();
            
        const filename = `${sanitizedTitle}-${clip.broadcaster_name}-${clip.creator_name}-${new Date(clip.created_at).toISOString().split('T')[0]}`;
        
        // Fortschritt anzeigen
        countDisplay.textContent = `${i+1}/${allClips.length}`;
        const progress = ((i+1) / allClips.length) * 100;
        progressRing.style.strokeDasharray = `${progress} 100`;
        
        // Clip herunterladen
        try {
            await downloadClip(clip.url, filename);
            // Erfolgsanzeige
            countDisplay.textContent = `${i+1}/${allClips.length} ✓`;
            // Kurze Pause zwischen Downloads
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`Fehler beim Herunterladen von Clip ${i+1}:`, error);
            // Anzeige für den Benutzer
            countDisplay.textContent = `${i+1}/${allClips.length} ✗`;
            // Kurze Pause, damit die Fehlermeldung sichtbar ist
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Fortfahren mit dem nächsten Clip
        }
    }
    
    // Zurücksetzen, wenn nicht abgebrochen
    if (!isCancelled) {
        button.classList.remove('downloading');
        cancelButton.style.display = 'none';
        alert('Alle Clips wurden heruntergeladen');
    }
}

// Initialisierung
document.addEventListener('DOMContentLoaded', () => {
    handleOAuthCallback();
    checkAuthStatus();
}); 