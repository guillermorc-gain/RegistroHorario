(function(){var t=localStorage.getItem('tema');if(t&&t!=='azul')document.body.classList.add('theme-'+t);})();
'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
// drive.file is needed on top of appdata: appdata can only write to a hidden
// folder, so the monthly export could not create a visible "Movilidad Emt".
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file profile email';
const AUTH_SCOPE       = 'profile email';
// Turnos de cada puesto. La hora de entrada registrada decide en cuál cae.
let PUESTOS_DEFINIDOS = ['Son Rossinyol', 'Control', 'Calle', 'Taller', 'Anselmo Clavé'];

const TURNOS_POR_PUESTO = {
    'son rossinyol': [
        { id: 'M', nombre: 'Mañana', desde: '03:45', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
        { id: 'N', nombre: 'Noche',  desde: '21:00', hasta: '04:00' },
    ],
    'control': [
        { id: 'M', nombre: 'Mañana', desde: '05:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '20:00' },
        { id: 'N', nombre: 'Noche',  desde: '20:00', hasta: '24:00' },
    ],
    'taller': [
        { id: 'M', nombre: 'Mañana', desde: '06:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
        { id: 'N', nombre: 'Noche',  desde: '21:00', hasta: '06:00' },
    ],
    'calle': [
        { id: 'M', nombre: 'Mañana', desde: '07:00', hasta: '14:00' },
        { id: 'T', nombre: 'Tarde',  desde: '14:00', hasta: '21:00' },
    ],
};

// El catálogo que mantiene el gestor manda sobre la tabla de aquí abajo: así
// se pueden cambiar turnos y añadir lugares sin publicar una versión nueva.
let LUGARES_CATALOGO = {};
function aplicarCatalogoLugares(cat) {
    LUGARES_CATALOGO = cat || {};
    Object.entries(LUGARES_CATALOGO).forEach(([k, l]) => {
        // Un turno de 00:00 a 00:00 no es un turno: es lo que queda cuando se
        // le vacían las horas para quitarlo. Se descarta, y si el lugar se
        // queda sin ninguno se respeta —el taller no tiene mañana ni tarde—
        // en vez de recaer en la tabla de aquí arriba.
        if (Array.isArray(l?.turnos)) {
            TURNOS_POR_PUESTO[k] = l.turnos.filter(f => f && f.desde && f.hasta && f.desde !== f.hasta);
        }
        const nombre = l?.nombre;
        if (nombre && !PUESTOS_DEFINIDOS.some(p => p.toLowerCase().normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '') === k)) {
            PUESTOS_DEFINIDOS.push(nombre);
        }
    });
}

const SUPER_USER_EMAIL = 'guillermo.rc82@gmail.com';
const ALLOWLIST_APP    = 'movilidad';
const LUGARES_URL      = 'https://registro-horario-emt.vercel.app/api/lugares';
const VERSION_URL      = 'https://registro-horario-emt.vercel.app/api/version';
const ANDROID_PACKAGE  = 'com.guillermorc.horasemt';
const RELEASE_PREFIX   = 'build-';
const DRIVE_FILE_NAME  = 'horas-emt.json';
const HORAS_ANUALES    = 777;

const NOCHE_INICIO_MIN = 21 * 60;
const NOCHE_FIN_MIN    = 6  * 60;

const AVATAR_EMOJIS = ['🚌','⭐','🔥','⚡','🌊','🎯','🚀','🦸','🎨','🌈'];
const AVATAR_BG     = ['#667eea','#e74c3c','#f39c12','#27ae60','#3498db','#9b59b6','#1abc9c','#e67e22','#764ba2','#e91e63'];
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const app = {
    accessToken: localStorage.getItem('gAccessToken') || null,
    tokenExpiry: parseInt(localStorage.getItem('gTokenExpiry') || '0'),
    refreshToken: localStorage.getItem('gRefreshToken') || null,
    driveFileId: localStorage.getItem('driveFileId') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    horasAnualesCustom: parseFloat(localStorage.getItem('horasAnuales')) || HORAS_ANUALES,
    precioNocheDefault: parseFloat(localStorage.getItem('precioNoche')) || 0,
    precioExtraDefault: parseFloat(localStorage.getItem('precioExtra')) || 0,
    precioFestivoDefault: parseFloat(localStorage.getItem('precioFestivo')) || 0,
    // Antigüedad: se fija una vez en el perfil y de ahí la coge cada nómina.
    fechaAltaDefault: localStorage.getItem('fechaAlta') || '',
    pctBieniosDefault: parseFloat(localStorage.getItem('pctBieniosManual')) || 0,
    modalCallback: null,
    editingId: null,
    prActivo: false,
    festivoActivo: false,
    extraActivo: false,
    vacacionesActivo: false,
    jornadaHoras: parseFloat(localStorage.getItem('jornadaHoras')) || 7.5,
    // Días de la semana que se trabaja. Vacío = todos, que es como se comportaba
    // antes de existir este ajuste.
    diasSemana: (() => { try { const d = JSON.parse(localStorage.getItem('diasSemana') || 'null');
        return Array.isArray(d) ? d : null; } catch (_) { return null; } })(),
    numConductor: localStorage.getItem('numConductor') || '',
    puestoTrabajo: localStorage.getItem('puestoTrabajo') || '',
    backupFreq: localStorage.getItem('backupFreq') || 'cerrar',
    _backupTimer: null,
    _activeTab: 0,
    _dragSrcTab: null,
    _allowedUsersLocal: null,
    tema: localStorage.getItem('tema') || 'azul',
    _historialMap: {},
    _historialFull: {},
    _bgGeoStarted: false,
    _notifEnviadaAt: 0,
    _geoWatcherId: null,
    _lastGeoCheck: 0,
    gpsMode: localStorage.getItem('gpsMode') || 'always',
    gpsInterval: parseInt(localStorage.getItem('gpsInterval') || '60'),
    gpsScheduleFrom: localStorage.getItem('gpsScheduleFrom') || '07:00',
    gpsScheduleTo: localStorage.getItem('gpsScheduleTo') || '09:00',
    _scheduleTimer: null,
    _tokenRefreshTimer: null,
    _toastTimer: null,
    _pendingNotifAction: null,
    notifSound: localStorage.getItem('notifSound') || 'default',
    _updateApkUrl: null,

    async init() {
        this._instalarFirmaApi();
        // The update check must run even if any earlier step throws, otherwise a
        // single bug anywhere above strands the user on an old build forever.
        setTimeout(() => { try { this._checkForUpdates(); } catch(_) {} }, 1500);
        this._migrarUbicacionAntigua();
        this.setupUI();
        if (this.darkMode) this.aplicarDarkMode();
        this._restaurarTabs();
        this._restaurarMensual();
        this._cargarCuadrante();
        this._aplicarModoVacaciones();
        this._buildAvatarGrid();
        this._setupDeepLinkListener();
        this._setupAppLifecycleBackup();
        this._setupNotificationActions(); // must register listener before any async
        this._setupNotifChat();           // y las del chat, por lo mismo
        this._initGoogleAuth();
        this._actualizarVersionDisplay();
    },

    _migrarUbicacionAntigua() {
        const old = localStorage.getItem('workLocation');
        if (old && !localStorage.getItem('workLocations')) {
            const loc = JSON.parse(old);
            localStorage.setItem('workLocations', JSON.stringify([{ name: 'Trabajo', lat: loc.lat, lng: loc.lng }]));
            localStorage.removeItem('workLocation');
        }
    },

    _initGoogleAuth() {
        const hashParams = window.location.hash.length > 1
            ? new URLSearchParams(window.location.hash.slice(1)) : null;
        const searchParams = window.location.search.length > 1
            ? new URLSearchParams(window.location.search.slice(1)) : null;

        const code  = searchParams?.get('code');
        const token = hashParams?.get('access_token') || searchParams?.get('access_token');
        const error = hashParams?.get('error') || searchParams?.get('error');

        if (code) {
            const pkgDestino = this._paqueteDestino(searchParams);
            if (this._rebotarAGestion(pkgDestino, searchParams)) return;
            history.replaceState(null, '', window.location.pathname);
            // PKCE: exchange code for tokens via Vercel endpoint
            if (!window.Capacitor && /Android/i.test(navigator.userAgent)) {
                // External Chrome on Android — bounce code back to native app via intent
                const intentUrl = `intent://localhost/?code=${encodeURIComponent(code)}#Intent;scheme=https;package=${pkgDestino};end`;
                document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1565C0;color:#fff;font-family:sans-serif;gap:20px;padding:32px;text-align:center;box-sizing:border-box;"><div style="font-size:56px;">✅</div><h2 style="margin:0;font-size:20px;font-weight:700;">¡Sesión iniciada!</h2><p style="margin:0;opacity:0.85;font-size:15px;">Volviendo a la app...</p><p style="margin:0;font-size:12px;opacity:0.6;">Puedes cerrar esta pestaña</p><a href="${intentUrl}" id="_oauthReturnBtn" style="background:#fff;color:#1565C0;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;margin-top:8px;display:inline-block;">Abrir la aplicación ›</a></div>`;
                setTimeout(() => document.getElementById('_oauthReturnBtn')?.click(), 300);
                setTimeout(() => { try { window.close(); } catch(e) {} }, 1200);
                return;
            }
            this._exchangeCode(code);
            return;
        }

        if (token || error) {
            const pkgDestino = this._paqueteDestino(searchParams);
            history.replaceState(null, '', window.location.pathname);
            if (token) {
                if (!window.Capacitor && /Android/i.test(navigator.userAgent)) {
                    const exp = hashParams?.get('expires_in') || '3600';
                    const intentUrl = `intent://localhost/?access_token=${encodeURIComponent(token)}&expires_in=${exp}#Intent;scheme=https;package=${pkgDestino};end`;
                    document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1565C0;color:#fff;font-family:sans-serif;gap:20px;padding:32px;text-align:center;box-sizing:border-box;"><div style="font-size:56px;">✅</div><h2 style="margin:0;font-size:20px;font-weight:700;">¡Sesión iniciada!</h2><p style="margin:0;opacity:0.85;font-size:15px;">Volviendo a la app...</p><p style="margin:0;font-size:12px;opacity:0.6;">Puedes cerrar esta pestaña</p><a href="${intentUrl}" id="_oauthReturnBtn" style="background:#fff;color:#1565C0;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;margin-top:8px;display:inline-block;">Abrir la aplicación ›</a></div>`;
                    setTimeout(() => document.getElementById('_oauthReturnBtn')?.click(), 300);
                    setTimeout(() => { try { window.close(); } catch(e) {} }, 1200);
                    return;
                }
                const expiresIn = parseInt(hashParams?.get('expires_in') || searchParams?.get('expires_in') || '3600');
                this.driveFileId = null;
                localStorage.removeItem('driveFileId');
                sessionStorage.removeItem('silentReauthAttempted');
                this._saveToken({ access_token: token, expires_in: expiresIn });
                this._loadUserAndStart();
                return;
            }
            if (!window.Capacitor && /Android/i.test(navigator.userAgent)) {
                const failUrl = `intent://localhost/?silent_failed=1#Intent;scheme=https;package=${pkgDestino};end`;
                setTimeout(() => { window.location.href = failUrl; }, 100);
                return;
            }
            this.mostrarAuth();
            this.mostrarMensaje('Error Google: ' + error, 'error');
            return;
        }

        if (this.accessToken && Date.now() < this.tokenExpiry) {
            this._loadUserAndStart();
        } else {
            const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
            const hasSession = !!(localStorage.getItem('gUserEmail') && (this.refreshToken || localStorage.getItem('gUserEmail')));
            if (hasSession && !sessionStorage.getItem('silentReauthAttempted')) {
                sessionStorage.setItem('silentReauthAttempted', '1');
                document.getElementById('authScreen')?.classList.add('hidden');
                this._silentReauth();
            } else {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
            }
        }
    },

    // Escucha appUrlOpen de Capacitor: se dispara cuando la app ya está abierta
    // (arranque en caliente) y recibe un deep-link intent con el token OAuth.
    _setupDeepLinkListener() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        try {
            window.Capacitor.Plugins.App?.addListener('appUrlOpen', (data) => {
                this._processOAuthUrl(data?.url);
            });
            window.Capacitor.Plugins.App?.addListener('backButton', () => {
                if (!this.atras()) window.Capacitor.Plugins.App?.minimizeApp?.();
            });
        } catch (_) {}
    },

    // Atrás cierra lo que haya abierto, de lo último a lo primero, y solo
    // cierra la app cuando ya no queda nada. Antes esto era una lista de tres
    // modales escrita a mano: cualquier cuadro nuevo —una conversación, un
    // lugar, el visor de una foto— se saltaba la lista y cerraba la app.
    atras() {
        // Los visores van por encima de todo
        const visor = [...document.querySelectorAll('.foto-visor.show, .cuad-visor.show')].pop();
        if (visor) {
            visor.classList.remove('show');
            document.getElementById('fotoVisorImg')?.removeAttribute('src');
            return true;
        }
        // De los cuadros abiertos, el de encima: el que más z-index tenga y,
        // a igualdad, el último del documento, que es como se apilan aquí.
        const abiertos = [...document.querySelectorAll('.modal.show')];
        if (abiertos.length) {
            const z = el => parseInt(getComputedStyle(el).zIndex, 10) || 0;
            const arriba = abiertos.reduce((a, b) => (z(b) >= z(a) ? b : a));
            arriba.classList.remove('show');
            return true;
        }
        if (document.getElementById('optionsScreen')?.classList.contains('active')) {
            this.mostrarApp();
            return true;
        }
        // Nada abierto: se devuelve false y decide quien llamó. En el móvil
        // llama Java, que hace moveTaskToBack; aquí no se minimiza nada para
        // no hacerlo dos veces.
        return false;
    },

    _processOAuthUrl(url) {
        if (!url) return;
        try {
            const u = new URL(url);
            if (u.searchParams.get('silent_failed') === '1') {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
                return;
            }
            const code = u.searchParams.get('code');
            if (code) {
                this.driveFileId = null;
                localStorage.removeItem('driveFileId');
                sessionStorage.removeItem('silentReauthAttempted');
                this._exchangeCode(code);
                return;
            }
            const token = u.searchParams.get('access_token');
            if (!token) return;
            const expiresIn = parseInt(u.searchParams.get('expires_in') || '3600');
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            this._saveToken({ access_token: token, expires_in: expiresIn });
            this._loadUserAndStart();
        } catch (_) {}
    },

    // Todas las escrituras a nuestra API van firmadas con el token de Google, y
    // el servidor saca de ahí quién eres en vez de creerse una cabecera. Se
    // engancha en fetch, en un único sitio, para que no se pueda olvidar en
    // ninguna llamada nueva.
    API_BASE: 'https://registro-horario-emt.vercel.app/api/',

    _instalarFirmaApi() {
        if (this._fetchOriginal) return;
        this._fetchOriginal = window.fetch.bind(window);
        const app = this;
        window.fetch = async function (recurso, opciones) {
            const url = typeof recurso === 'string' ? recurso : recurso?.url || '';
            // El intercambio de tokens no lleva token, por razones obvias
            if (!url.startsWith(app.API_BASE) || url.startsWith(app.API_BASE + 'auth/')) {
                return app._fetchOriginal(recurso, opciones);
            }
            const op = { ...(opciones || {}) };
            const metodo = (op.method || 'GET').toUpperCase();
            if (metodo !== 'GET' && metodo !== 'OPTIONS') {
                // Si está caducado se renueva antes: enviarlo vencido sería un 401
                if (app.accessToken && Date.now() >= app.tokenExpiry) {
                    try { await app._silentReauth(); } catch (_) {}
                }
                // Las cabeceras pueden venir como objeto o como Headers, y
                // esparcir un Headers da {} y se perdería el Content-Type.
                const h = new Headers(op.headers || {});
                if (app.accessToken) h.set('Authorization', `Bearer ${app.accessToken}`);
                op.headers = h;
            }
            return app._fetchOriginal(recurso, op);
        };
    },

    async _ensureToken() {
        return !!(this.accessToken && Date.now() < this.tokenExpiry);
    },

    _saveToken(response) {
        this.accessToken = response.access_token;
        this.tokenExpiry = Date.now() + (parseInt(response.expires_in) - 60) * 1000;
        localStorage.setItem('gAccessToken', this.accessToken);
        localStorage.setItem('gTokenExpiry', this.tokenExpiry);
        if (response.refresh_token) {
            this.refreshToken = response.refresh_token;
            localStorage.setItem('gRefreshToken', this.refreshToken);
        }
        window.AndroidBridge?.saveToPrefs('accessToken', this.accessToken);
        // The notification receiver needs these to renew an expired token on its own
        window.AndroidBridge?.saveToPrefs('tokenExpiry', String(this.tokenExpiry));
        if (this.refreshToken) window.AndroidBridge?.saveToPrefs('refreshToken', this.refreshToken);
        this._scheduleTokenRefresh();
    },

    _scheduleTokenRefresh() {
        clearTimeout(this._tokenRefreshTimer);
        const ms = this.tokenExpiry - Date.now() - 2 * 60 * 1000; // 2 min before expiry
        if (ms <= 0) { this._silentReauth(); return; }
        this._tokenRefreshTimer = setTimeout(() => this._silentReauth(), ms);
    },

    async _loadUserAndStart() {
        this._instalarFirmaApi();
        try {
            const ok = await this._ensureToken();
            if (!ok) { this._silentReauth(); return; }
            const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });
            if (!resp.ok) { this.mostrarAuth(); this.mostrarMensaje('Error al obtener perfil: ' + resp.status, 'error'); return; }
            this.usuarioActual = await resp.json();
            const prevEmail = localStorage.getItem('gUserEmail');
            if (prevEmail && prevEmail.toLowerCase() !== this.usuarioActual.email.toLowerCase()) {
                localStorage.removeItem('avatarPhoto');
                localStorage.removeItem('avatarEmoji');
                localStorage.removeItem('avatarBg');
            }
            localStorage.setItem('gUserEmail', this.usuarioActual.email);
            const authorized = await this._checkUserAuthorized(this.usuarioActual.email);
            if (!authorized) {
                this.mostrarAuth();
                this.mostrarMensaje('❌ La cuenta ' + this.usuarioActual.email + ' no tiene acceso a esta aplicación.', 'error');
                return;
            }
            this.mostrarApp();
            this.actualizarBotonesPerfil();
            this._actualizarCabeceraUsuario();
            this._cargarAsignacion();
            setTimeout(() => this._autoRellenarFormulario(), 50);
            this._scheduleTokenRefresh();
            this.cargarDatos();
        } catch(e) {
            this.mostrarAuth();
            this.mostrarMensaje('Error de red: ' + e.message, 'error');
        }
    },

    _generateVerifier() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return btoa(String.fromCharCode(...arr))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async _deriveChallenge(verifier) {
        const enc = new TextEncoder().encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', enc);
        return btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async login(silent = false) {
        const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
        const redirectUri = isAndroidNative
            ? 'https://registro-horario-emt.vercel.app/'
            : window.location.origin + '/';
        const email = this.usuarioActual?.email || localStorage.getItem('gUserEmail') || '';
        const verifier = this._generateVerifier();
        localStorage.setItem('pkceVerifier', verifier);
        const challenge = await this._deriveChallenge(verifier);
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: DRIVE_SCOPE,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            state: ANDROID_PACKAGE,
            prompt: silent ? 'none' : 'consent',
            ...(email ? { login_hint: email } : {})
        });
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
        if (isAndroidNative && window.AndroidBridge?.performOAuthInWebView
                && !sessionStorage.getItem('oauthWebViewFailed')) {
            window.AndroidBridge.performOAuthInWebView(url, silent);
        } else {
            window.location.assign(url);
        }
    },

    // The return page is served by the shared Vercel deployment, which runs apk2's
    // code, so without this every login would come back to apk2. Google echoes
    // `state` verbatim, so it tells us which app to reopen.
    // El verificador PKCE está en localStorage, que se comparte entre / y
    // /gestion/ por ser el mismo origen, así que el intercambio del código
    // funciona igual desde allí.
    _rebotarAGestion(pkgDestino, searchParams) {
        if (pkgDestino !== 'com.guillermorc.gestionemt') return false;
        if (window.Capacitor?.isNativePlatform?.()) return false;
        if (/Android/i.test(navigator.userAgent)) return false;   // ahí se vuelve por intent
        if (window.location.pathname.startsWith('/gestion')) return false;
        window.location.replace('/gestion/?' + searchParams.toString());
        return true;
    },

    _paqueteDestino(searchParams) {
        const permitidos = ['com.guillermorc.horasemt','com.guillermorc.gestionemt'];
        const s = searchParams?.get('state');
        return permitidos.includes(s) ? s : ANDROID_PACKAGE;
    },

    async _exchangeCode(code, isSilent = false) {
        const verifier = localStorage.getItem('pkceVerifier');
        localStorage.removeItem('pkceVerifier');
        if (!verifier) { this.mostrarAuth(); return; }
        const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
        const redirectUri = isAndroidNative
            ? 'https://registro-horario-emt.vercel.app/'
            : window.location.origin + '/';
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/auth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                if (!isSilent) {
                    this.mostrarAuth();
                    this.mostrarMensaje('Error al iniciar sesión: ' + (err.error || resp.status), 'error');
                } else {
                    sessionStorage.removeItem('silentReauthAttempted');
                    this.mostrarAuth();
                }
                return;
            }
            const data = await resp.json();
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            sessionStorage.removeItem('silentReauthAttempted');
            sessionStorage.removeItem('autoLoginAttempted');
            sessionStorage.removeItem('oauthWebViewFailed');
            this._saveToken(data);
            this._loadUserAndStart();
        } catch(e) {
            if (!isSilent) {
                this.mostrarAuth();
                this.mostrarMensaje('Error de red: ' + e.message, 'error');
            } else {
                sessionStorage.removeItem('silentReauthAttempted');
                this.mostrarAuth();
            }
        }
    },

    async _silentReauth() {
        if (this.refreshToken) {
            try {
                const resp = await fetch('https://registro-horario-emt.vercel.app/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh_token: this.refreshToken })
                });
                if (resp.ok) {
                    const data = await resp.json();
                    this._saveToken(data);
                    if (!this.usuarioActual) this._loadUserAndStart();
                    return;
                }
                // Refresh token expired/revoked — clear it and fall through to interactive login
                this.refreshToken = null;
                localStorage.removeItem('gRefreshToken');
            } catch (_) {}
        }
        if (!window.Capacitor?.isNativePlatform?.()) { this.mostrarAuth(); return; }
        this.login(true);
    },

    _onOAuthCode(code, isSilent = false) {
        if (!code) {
            if (!isSilent) sessionStorage.setItem('oauthWebViewFailed', '1');
            sessionStorage.removeItem('silentReauthAttempted');
            if (isSilent && window.Capacitor?.isNativePlatform?.()
                    && !sessionStorage.getItem('autoLoginAttempted')) {
                sessionStorage.setItem('autoLoginAttempted', '1');
                const msg = document.getElementById('splashMsg');
                if (msg) msg.textContent = 'Conectando con Google...';
                this.login(false);
                return;
            }
            sessionStorage.removeItem('autoLoginAttempted');
            this.mostrarAuth();
            return;
        }
        sessionStorage.removeItem('autoLoginAttempted');
        sessionStorage.removeItem('oauthWebViewFailed');
        sessionStorage.removeItem('silentReauthAttempted');
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        this._exchangeCode(code, isSilent);
    },

    _onOAuthResult(token, expiresIn, wasSilent = false) {
        if (!token) {
            if (!wasSilent) sessionStorage.setItem('oauthWebViewFailed', '1');
            sessionStorage.removeItem('silentReauthAttempted');
            // En nativo: si el reauth silencioso falló, lanzar login interactivo
            // automáticamente sin mostrar la pantalla de inicio de sesión.
            if (wasSilent && window.Capacitor?.isNativePlatform?.()
                    && !sessionStorage.getItem('autoLoginAttempted')) {
                sessionStorage.setItem('autoLoginAttempted', '1');
                const msg = document.getElementById('splashMsg');
                if (msg) msg.textContent = 'Conectando con Google...';
                this.login(false);
                return;
            }
            sessionStorage.removeItem('autoLoginAttempted');
            this.mostrarAuth();
            return;
        }
        sessionStorage.removeItem('autoLoginAttempted');
        sessionStorage.removeItem('oauthWebViewFailed');
        sessionStorage.removeItem('silentReauthAttempted');
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        this._saveToken({ access_token: token, expires_in: parseInt(expiresIn) || 3600 });
        this._loadUserAndStart();
    },

    _setupAppLifecycleBackup() {
        const onBackground = () => {
            this._pararSondeoChat();
            if (this.backupFreq !== 'cerrar') return;
            if (this.accessToken && Date.now() < this.tokenExpiry) this._autoBackup();
        };
        const onForeground = () => {
            // Al volver se miran los mensajes: es lo que hace que salte el
            // aviso cuando la app estaba de fondo.
            this._iniciarSondeoChat();
            // Si se ha entrado tocando el aviso nativo, se abre en las notas
            if (window.AndroidBridge?.getPref?.('abrirNotas') === '1') {
                window.AndroidBridge?.removePref?.('abrirNotas');
                this.switchTab(2);
            }
            if (this.usuarioActual) this._cargarNotas();
            // Y lo que te toca hoy: el gestor puede haberlo cambiado mientras
            // la app estaba de fondo, o sencillamente haber cambiado el día.
            if (this.usuarioActual) this._cargarAsignacion();
            // If RegistrarReceiver updated Drive while in background, refresh the data
            const flag = window.AndroidBridge?.getPref?.('pendingRefresh');
            if (flag === '1' && this.usuarioActual) {
                window.AndroidBridge?.removePref?.('pendingRefresh');
                this.cargarDatos();
            }
            // Check for updates every time the app is opened, even if it was
            // only in the background. The short guard is just so flipping in and
            // out fast does not burn the GitHub API's 60 requests/hour limit.
            const lastCheck = parseInt(sessionStorage.getItem('lastUpdateCheck') || '0');
            if (Date.now() - lastCheck > 90 * 1000) {
                this._checkForUpdates();
            }
        };
        if (window.Capacitor?.isNativePlatform?.()) {
            try {
                window.Capacitor.Plugins.App?.addListener('appStateChange', ({ isActive }) => {
                    if (!isActive) onBackground(); else onForeground();
                });
            } catch (_) {}
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) onBackground(); else onForeground();
        });
        this._iniciarTimerCopia();
    },

    _iniciarTimerCopia() {
        clearInterval(this._backupTimer);
        const periodos = { hora: 60 * 60 * 1000, dia: 24 * 60 * 60 * 1000 };
        const ms = periodos[this.backupFreq];
        if (!ms) return;   // 'cerrar' is handled by the lifecycle listener
        const tick = () => {
            const ultima = parseInt(localStorage.getItem('lastBackupTime') || '0', 10);
            if (Date.now() - ultima < ms) return;
            if (this.accessToken && Date.now() < this.tokenExpiry) this._autoBackup();
        };
        tick();
        this._backupTimer = setInterval(tick, 5 * 60 * 1000);
    },

    guardarFrecuenciaCopia(freq) {
        this.backupFreq = freq;
        localStorage.setItem('backupFreq', freq);
        this._iniciarTimerCopia();
        this._guardarPreferencias();
        const txt = { hora: 'cada hora', dia: 'cada día', cerrar: 'al cerrar la app' }[freq] || freq;
        this._mostrarToast('✅ Copia automática ' + txt, 2500);
    },

    // ── Monthly export to Drive: "Movilidad Emt / <nº> <nombre>" ──────────────

    async _carpetaDrive(nombre, parentId) {
        const q = `name='${nombre.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder'`
                + ` and trashed=false and '${parentId || 'root'}' in parents`;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
        if (resp.ok) {
            const d = await resp.json();
            if (d.files?.length) return d.files[0].id;
        }
        const crear = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nombre,
                mimeType: 'application/vnd.google-apps.folder',
                ...(parentId ? { parents: [parentId] } : {})
            })
        });
        if (!crear.ok) throw new Error('No se pudo crear la carpeta ' + nombre);
        return (await crear.json()).id;
    },

    async _subirJsonADrive(nombreArchivo, contenido, carpetaId) {
        const boundary = '-------horasemt' + Date.now();
        const meta = JSON.stringify({ name: nombreArchivo, parents: [carpetaId] });
        const body = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
                   + `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${contenido}\r\n--${boundary}--`;
        const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.accessToken}`,
                       'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!resp.ok) throw new Error('Subida fallida: ' + resp.status);
        return resp.json();
    },

    _mesesPendientesExport(historial) {
        const hechos = new Set(JSON.parse(localStorage.getItem('mesesExportados') || '[]'));
        const hoy = new Date();
        const claveMesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
        const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
        const esUltimoDia = hoy.getDate() === ultimoDia;
        const meses = new Set();
        Object.values(historial || {}).forEach(r => {
            if (!r.timestamp) return;
            const d = new Date(r.timestamp);
            meses.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        });
        // A month is exportable once it is over — or today if it is its last day
        return [...meses].filter(m =>
            !hechos.has(m) && (m < claveMesActual || (m === claveMesActual && esUltimoDia))
        ).sort();
    },

    async _exportarMesesPendientes() {
        if (!this.usuarioActual || !this.accessToken) return;
        const historial = this._historialFull || {};
        const pendientes = this._mesesPendientesExport(historial);
        if (!pendientes.length) return;
        try {
            const raiz = await this._carpetaDrive('Movilidad Emt', null);
            const sub  = [this.numConductor, this.usuarioActual.name].filter(Boolean).join(' ')
                       || this.usuarioActual.email;
            const carpeta = await this._carpetaDrive(sub, raiz);
            const hechos = new Set(JSON.parse(localStorage.getItem('mesesExportados') || '[]'));
            for (const mes of pendientes) {
                const delMes = Object.entries(historial)
                    .filter(([, r]) => {
                        const d = new Date(r.timestamp);
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === mes;
                    })
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)
                    .map(([id, r]) => ({ id, ...r }));
                const tot = this._calcTotales(historial);
                const mesJson = JSON.stringify({
                    mes, generado: new Date().toISOString(),
                    conductor: this.numConductor || null,
                    nombre: this.usuarioActual.name || null,
                    email: this.usuarioActual.email,
                    totalHoras: Math.round(delMes.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0) * 10) / 10,
                    horasNocturnas: Math.round(delMes.reduce((s, r) => s + (r.horasNocturnas || 0), 0) * 10) / 10,
                    diasFestivos: delMes.filter(r => r.festivo).length,
                    permisosRetribuidos: delMes.filter(r => r.pr).length,
                    jornadas: delMes
                }, null, 2);
                const completoJson = JSON.stringify({
                    generado: new Date().toISOString(),
                    conductor: this.numConductor || null,
                    nombre: this.usuarioActual.name || null,
                    email: this.usuarioActual.email,
                    horasAnuales: this.horasAnualesCustom,
                jornadaHoras: this.jornadaHoras,
                dias:         this.diasSemana,
                vacaciones:   this._getVacaciones(),
                vacacionesAt: this._vacacionesAt(),
                    totales: tot,
                    historial: Object.entries(historial)
                        .sort((a, b) => a[1].timestamp - b[1].timestamp)
                        .map(([id, r]) => ({ id, ...r }))
                }, null, 2);
                await this._subirJsonADrive(`horas-emt-${mes}.json`, mesJson, carpeta);
                await this._subirJsonADrive(`horas-emt-completo-${mes}.json`, completoJson, carpeta);
                hechos.add(mes);
                localStorage.setItem('mesesExportados', JSON.stringify([...hechos]));
            }
        } catch (_) { /* silent: it retries next time the app opens */ }
    },

    _autoRellenarFormulario() {
        const inicio = localStorage.getItem('lastHoraInicio');
        const fin    = localStorage.getItem('lastHoraFin');
        if (inicio) document.getElementById('horaInicio').value = inicio;
        if (fin)    document.getElementById('horaFin').value    = fin;
        if (inicio && fin) this.calcularHorasPorTiempo();
    },

    setupUI() {
        this._aplicarCuadros();
        this._renderLugarJornada();
        this.establecerFechaHoy();
        this.actualizarFecha();
        if (this.precioExtraDefault > 0) {
            const pe = document.getElementById('precioExtraGlobal');
            if (pe) pe.value = this.precioExtraDefault;
        }
        if (this.precioNocheDefault > 0) {
            document.getElementById('precioNocheGlobal').value = this.precioNocheDefault;
        }
        const fa = document.getElementById('fechaAltaGlobal');
        if (fa) fa.value = this.fechaAltaDefault || '';
        const pb = document.getElementById('pctBieniosGlobal');
        if (pb && this.pctBieniosDefault) pb.value = this.pctBieniosDefault;
        this.actualizarEstadoGPS();
        const lastInicio = localStorage.getItem('lastHoraInicio');
        if (lastInicio) document.getElementById('horaInicio').value = lastInicio;
        const lastFin = localStorage.getItem('lastHoraFin');
        if (lastFin) document.getElementById('horaFin').value = lastFin;
        if (lastInicio && lastFin) this.calcularHorasPorTiempo();
    },

    async _driveGet(url) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        return fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    },

    async _drivePatch(url, body) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        return fetch(url, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body)
        });
    },

    _recordarFicheroDrive(id) {
        this.driveFileId = id;
        localStorage.setItem('driveFileId', id);
        window.AndroidBridge?.saveToPrefs('driveFileId', id);
    },

    // Una búsqueda fallida no puede pasar por "no hay copia": si pasa, el que
    // llama se cree que el historial está vacío y escribe encima, o crea una
    // segunda copia y la historia se parte en dos.
    async _listarFicherosDrive() {
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'${DRIVE_FILE_NAME}'`
            + `&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`
        );
        if (!resp.ok) throw new Error('Drive buscar: ' + resp.status);
        const data = await resp.json();
        return Array.isArray(data.files) ? data.files : [];
    },

    async _getDriveFileId() {
        if (this.driveFileId) return this.driveFileId;
        const files = await this._listarFicherosDrive();
        if (!files.length) return null;                 // aún no hay copia
        if (files.length > 1) return this._unirFicherosDrive(files);
        this._recordarFicheroDrive(files[0].id);
        return this.driveFileId;
    },

    // Si han quedado varias copias con el mismo nombre, se juntan todas las
    // jornadas en la más reciente y a las demás se les cambia el nombre, para
    // que la búsqueda deje de encontrarlas y no se vuelva a partir.
    async _unirFicherosDrive(files) {
        const contenidos = [];
        for (const f of files) {
            try {
                const r = await this._driveGet(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
                if (r.ok) contenidos.push({ id: f.id, datos: await r.json() });
            } catch (_) { /* si una no se puede leer, se deja donde está */ }
        }
        if (!contenidos.length) { this._recordarFicheroDrive(files[0].id); return this.driveFileId; }
        const historial = {};
        contenidos.forEach(({ datos }) => {
            Object.entries(datos?.historial || {}).forEach(([id, r]) => {
                // Ante el mismo día repetido gana el que se tocó más tarde
                const ya = historial[id];
                if (!ya || (r?.timestamp || 0) >= (ya.timestamp || 0)) historial[id] = r;
            });
        });
        const principal = contenidos[0];                 // el de modificación más reciente
        const unido = { ...principal.datos, historial };
        unido.horasTrabajadas = this._calcTotales(historial).anualReal;
        this._recordarFicheroDrive(principal.id);
        const antes = Object.keys(principal.datos?.historial || {}).length;
        const ahora = Object.keys(historial).length;
        if (ahora > antes) {
            await this._writeDriveFile(unido);
            this._mostrarToast(`✅ Recuperadas ${ahora - antes} jornada${ahora - antes === 1 ? '' : 's'} de otra copia`, 5000);
        }
        for (const c of contenidos.slice(1)) {
            try {
                await fetch(`https://www.googleapis.com/drive/v3/files/${c.id}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: `${DRIVE_FILE_NAME}.copia-${c.id.slice(0, 8)}` })
                });
            } catch (_) { /* si no se puede renombrar, se volverá a unir la próxima vez */ }
        }
        return this.driveFileId;
    },

    // null significa "todavía no hay copia", nunca "no se ha podido leer": un
    // fallo de lectura tiene que doler aquí y no acabar borrando el historial.
    async _readDriveFile() {
        const fileId = await this._getDriveFileId();
        if (!fileId) return null;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        if (resp.status === 404) {
            // El id guardado ya no vale; se busca otra vez desde cero
            this.driveFileId = null;
            localStorage.removeItem('driveFileId');
            const otros = await this._listarFicherosDrive();
            if (!otros.length) return null;
            return this._readDriveFile();
        }
        if (!resp.ok) throw new Error('Drive leer: ' + resp.status);
        return resp.json();
    },

    async _writeDriveFile(data) {
        if (!await this._ensureToken()) throw new Error('Sin autenticación');
        const payload = { ...data, preferencias: this._getPreferencias() };
        const json    = JSON.stringify(payload);
        const fileId  = await this._getDriveFileId();

        if (!fileId) {
            const boundary = '-------314159265358979323846';
            const meta     = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'] });
            const body     = `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
            const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`
                },
                body
            });
            if (!resp.ok) { const t = await resp.text(); throw new Error('Drive crear: ' + resp.status + ' ' + t.slice(0,120)); }
            const result = await resp.json();
            if (!result.id) throw new Error('Drive crear: sin id en respuesta');
            this.driveFileId = result.id;
            localStorage.setItem('driveFileId', result.id);
            window.AndroidBridge?.saveToPrefs('driveFileId', result.id);
        } else {
            const resp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: json
            });
            if (!resp.ok) { const t = await resp.text(); throw new Error('Drive actualizar: ' + resp.status + ' ' + t.slice(0,120)); }
        }
        localStorage.setItem('lastBackupTime', Date.now().toString());
    },

    async _autoBackup() {
        const lastBackup = parseInt(localStorage.getItem('lastBackupTime') || '0');
        if (Date.now() - lastBackup < 5 * 60 * 1000) return;
        if (this._autoBackupBusy) return;
        if (!this.accessToken || Date.now() >= this.tokenExpiry) return;
        this._autoBackupBusy = true;
        try {
            const data = await this._readDriveFile();
            if (data) await this._writeDriveFile(data);
        } catch (_) {}
        this._autoBackupBusy = false;
    },

    async hacerCopiaEnDrive() {
        if (!this.usuarioActual) { this._mostrarToast('❌ Inicia sesión primero', 3000); return; }
        this._mostrarToast('☁️ Guardando copia...', 2000);
        try {
            const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            await this._writeDriveFile(data);
            this._mostrarToast('✅ Copia guardada en Google Drive', 3000);
            this._actualizarInfoCopia();
        } catch (e) {
            this._mostrarToast('❌ Error al guardar: ' + e.message, 4000);
        }
    },

    async restaurarDesdeDrive() {
        if (!this.usuarioActual) { this._mostrarToast('❌ Inicia sesión primero', 3000); return; }
        if (!confirm('¿Restaurar datos desde Google Drive?\nSe aplicarán los datos de la última copia guardada.')) return;
        this._mostrarToast('⬇️ Restaurando...', 2000);
        try {
            const data = await this._readDriveFile();
            if (!data) { this._mostrarToast('❌ No se encontró copia en Drive', 3000); return; }
            if (data.preferencias) this._aplicarPreferenciasDesde(data.preferencias);
            this.actualizarUI(data);
            this._mostrarToast('✅ Datos restaurados desde Google Drive', 3000);
            this._actualizarInfoCopia();
        } catch (e) {
            this._mostrarToast('❌ Error al restaurar: ' + e.message, 4000);
        }
    },

    _actualizarInfoCopia() {
        const radio = document.querySelector(`input[name="backupFreq"][value="${this.backupFreq}"]`);
        if (radio) radio.checked = true;
        const bloqueResumen = document.getElementById('resumenMensualField');
        if (bloqueResumen) {
            const soloPara = 'g.rioscorrea@gmail.com';
            bloqueResumen.style.display =
                (this.usuarioActual?.email || '').toLowerCase() === soloPara ? 'flex' : 'none';
        }
        const info = document.getElementById('mesesExportadosInfo');
        if (info) {
            const hechos = JSON.parse(localStorage.getItem('mesesExportados') || '[]');
            info.textContent = hechos.length
                ? `Último mes guardado: ${hechos.sort().slice(-1)[0]}` : '';
        }
        const el = document.getElementById('lastBackupInfo');
        if (!el) return;
        const t = parseInt(localStorage.getItem('lastBackupTime') || '0');
        if (!t) { el.textContent = 'Sin copia registrada aún'; return; }
        const d = new Date(t);
        el.textContent = 'Última copia: ' + d.toLocaleDateString('es-ES')
            + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    },

    async cargarDatos() {
        if (!this.usuarioActual) return;
        try {
            const data = await this._readDriveFile();
            if (data?.preferencias) this._aplicarPreferenciasDesde(data.preferencias);
            this.actualizarUI(data || { horasTrabajadas: 0, historial: {} });
            this._lecturaOk = true;
            this._renderGpsSettings();
            this._startScheduleTimer();
            this.verificarUbicacion();
            this._updateGpsState();
            this._exportarMesesPendientes();
            this._publicarResumen();
            this._cargarNotas();
            this._cargarLugares();
            this._pedirPermisosIniciales();
            if (this._pendingNotifAction === 'registro-rapido') {
                this._pendingNotifAction = null;
                this._registrarDesdeNotificacion();
            }
        } catch(e) {
            console.error('Error cargando datos:', e);
            // Sin lectura no se pinta un historial vacío: parecería que se ha
            // perdido todo, y encima se publicaría ese vacío a gestión.
            this._lecturaOk = false;
            if (!this._historialFull || !Object.keys(this._historialFull).length) {
                this.actualizarUI({ horasTrabajadas: 0, historial: {} });
            }
            this._mostrarToast('⚠️ No se ha podido leer tu copia: ' + e.message, 6000);
        }
    },

    async registrarHoras() {
        if (!this.usuarioActual) { alert('❌ No hay sesión activa'); return; }
        const horasRaw = document.getElementById('horasInput').value;
        let   horas = parseFloat(horasRaw) || 0;
        const fecha = document.getElementById('fechaInput').value;
        const esFestivo      = this.festivoActivo;
        const esVacaciones   = this.vacacionesActivo;
        const esBaja         = this.bajaActiva;
        // A holiday, a vacation day or a sick day may be registered with no
        // hours worked; anything else needs hours.
        if (!fecha || (!esFestivo && !esVacaciones && !esBaja && (isNaN(parseFloat(horasRaw)) || horas <= 0))) {
            alert('❌ Introduce fecha y horas válidas'); return;
        }
        if (horas < 0) { alert('❌ Las horas no pueden ser negativas'); return; }
        const horaInicio     = document.getElementById('horaInicio').value;
        let   horaFin        = document.getElementById('horaFin').value;
        // Todos los sitios del día, el del desplegable incluido
        const tramos = this._tramosDelDia();
        const total  = this._jornadaDeLosTramos(tramos);
        if (total) { horaFin = total.fin; horas = total.horas; }
        const esNoche        = document.getElementById('nocheToggle').checked;
        const esPR           = this.prActivo;
        const esExtra        = this.extraActivo;
        const extraDestino   = esExtra ? this._extraDestino() : null;
        const horasNocturnas = esNoche ? (parseFloat(document.getElementById('horasNocturnas').value) || 0) : 0;
        const precioNoche    = esNoche ? (parseFloat(document.getElementById('precioNoche').value) || 0) : 0;
        const extraNoche     = Math.round(horasNocturnas * precioNoche * 100) / 100;
        if (esNoche && horasNocturnas > horas) { alert('❌ Las horas nocturnas no pueden superar las horas totales'); return; }

        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            datos.horasTrabajadas = parseFloat(datos.horasTrabajadas) || 0;
            if (!datos.historial) datos.historial = {};

            // Este botón siempre añade una jornada. Editar es cosa del cuadro de
            // editar, que guarda por su cuenta: mientras esto miraba editingId,
            // abrir el lápiz de una jornada, cerrarlo sin guardar y registrar
            // otra del mismo día borraba la primera y la dejaba en una sola,
            // sin aviso ni rastro.
            const fechaFormato = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const fechaKey     = fecha.replace(/-/g, '');
            const registroId   = this._nuevoRegistroId(datos.historial, fechaKey);
            datos.historial[registroId] = {
                fecha: fechaFormato, horas,
                timestamp: new Date(fecha + 'T12:00:00').getTime(),
                ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
                ...(esNoche && horasNocturnas > 0 ? { horasNocturnas, precioNoche, extraNoche } : {}),
                ...(esPR ? { pr: true } : {}),
                ...(esFestivo ? { festivo: true } : {}),
                ...(this.puestoTrabajo ? { puesto: this.puestoTrabajo } : {}),
                ...(esExtra ? { extraManual: true, extraDestino } : {}),
                ...(esVacaciones ? { vacaciones: true } : {}),
                ...(esBaja ? { be: true } : {}),
                ...(tramos.length ? { tramos } : {})
            };
            if (esPR && this._prUsados(datos.historial) > this.PR_ANUALES) {
                delete datos.historial[registroId];
                alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`);
                return;
            }
            const tot = this._calcTotales(datos.historial);
            if (tot.anualReal > this.horasAnualesCustom + tot.topeExtras) {
                delete datos.historial[registroId];
                alert(`❌ Superarías el tope anual + 30% de extras (${(this.horasAnualesCustom + tot.topeExtras).toFixed(1)}h)`);
                return;
            }
            datos.horasTrabajadas = tot.anualReal;

            if (horaInicio && horaFin) {
                if (!datos.prefs) datos.prefs = {};
                datos.prefs.horaInicio = horaInicio;
                datos.prefs.horaFin = horaFin;
            }
            await this._writeDriveFile(datos);
            localStorage.setItem('lastRegisteredDate', fechaKey);
            window.AndroidBridge?.saveToPrefs('lastRegisteredDate', fechaKey);
            if (horaInicio) localStorage.setItem('lastHoraInicio', horaInicio);
            const horaFinVal = document.getElementById('horaFin').value;
            if (horaFinVal) localStorage.setItem('lastHoraFin', horaFinVal);
            this._detenerGeofencingNativo();
            this._cancelarNotificacionTrabajo();
            this.actualizarUI(datos);
            this.cancelarEdicion();
            this._publicarResumen();
            this._comprobarLugarPorUbicacion();
            // Decir qué ha quedado: con dos jornadas en un día es la única
            // forma de saber si se han guardado las dos.
            const delDia = Object.keys(datos.historial)
                .filter(id => this._fechaDeId(id) === fechaKey).length;
            this._mostrarToast(delDia > 1
                ? `✅ Guardada · ${delDia} jornadas ese día`
                : '✅ Jornada guardada', 3000);
        } catch(e) {
            alert('❌ Error al guardar: ' + e.message);
        }
    },

    async _guardarDesdeModal() {
        if (!this.usuarioActual || !this.editingId) return;
        const fecha     = document.getElementById('editModalFecha').value;
        const horas     = parseFloat(document.getElementById('editModalHoras').value);
        const horaInicio= document.getElementById('editModalInicio').value;
        const horaFin   = document.getElementById('editModalFin').value;
        const horasN    = parseFloat(document.getElementById('editModalNocturnas').value) || 0;
        const precioN   = parseFloat(document.getElementById('editModalPrecioN').value) || 0;
        const esPR      = document.getElementById('editModalPR').checked;
        const esFestivo = document.getElementById('editModalFestivo').checked;
        const prev      = this._historialMap?.[this.editingId] || {};
        if (!fecha || (!esFestivo && (isNaN(horas) || horas <= 0))) { alert('❌ Introduce fecha y horas válidas'); return; }

        const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        if (!datos.historial) datos.historial = {};

        delete datos.historial[this.editingId];
        const fechaFormato = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const fechaKey     = fecha.replace(/-/g, '');
        // Keep the same id when the date is unchanged, otherwise allocate a fresh one
        const registroId   = this._fechaDeId(this.editingId) === fechaKey
            ? this.editingId : this._nuevoRegistroId(datos.historial, fechaKey);
        datos.historial[registroId] = {
            fecha: fechaFormato, horas: horas || 0,
            timestamp: new Date(fecha + 'T12:00:00').getTime(),
            ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
            ...(horasN > 0 ? { horasNocturnas: horasN, precioNoche: precioN, extraNoche: Math.round(horasN * precioN * 100) / 100 } : {}),
            ...(esPR ? { pr: true } : {}),
            ...(esFestivo ? { festivo: true } : {}),
            ...(prev.extraManual ? { extraManual: true, extraDestino: prev.extraDestino } : {})
        };
        datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;

        await this._writeDriveFile(datos);
        this.editingId = null;
        document.getElementById('editModal').classList.remove('show');
        this.actualizarUI(datos);
        this._publicarResumen();
        // Volver al listado, no a la pantalla principal
        this.mostrarHistorialModal();
    },

    async borrarRegistro(id) {
        if (!this.usuarioActual) return;
        if (!confirm('¿Borrar este registro?')) return;
        const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        if (datos.historial && datos.historial[id]) {
            delete datos.historial[id];
            datos.horasTrabajadas = this._calcTotales(datos.historial).anualReal;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
            this._publicarResumen();
            if (this.editingId === id) this.editingId = null;
            if (document.getElementById('historialModal').classList.contains('show')) this._renderHistorialModal();
        }
    },

    async resetearContador() {
        if (!this.usuarioActual) return;
        const datos = { horasTrabajadas: 0, historial: {} };
        await this._writeDriveFile(datos);
        this.actualizarUI(datos);
        alert('✅ Contador reseteado a 0');
    },

    async borrarCuenta() {
        if (!this.usuarioActual) return;
        const fileId = await this._getDriveFileId();
        if (fileId) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.accessToken}` }
            }).catch(() => {});
        }
        this.driveFileId = null;
        localStorage.removeItem('driveFileId');
        await this.cerrarSesion();
    },

    async exportarDatos() {
        if (!this.usuarioActual) return;
        const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
        const historial = Object.entries(data.historial || {})
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .map(([id, reg]) => ({ id, ...reg }));
        const json = JSON.stringify({
            exportado: new Date().toISOString(),
            usuario: this.usuarioActual.email,
            horasAnuales: this.horasAnualesCustom,
            horasTrabajadas: data.horasTrabajadas || 0,
            historial
        }, null, 2);
        const filename = `horas-emt-${new Date().toISOString().slice(0,10)}.json`;
        const blob = new Blob([json], { type: 'application/json' });
        const file = new File([blob], filename, { type: 'application/json' });
        if (window.Capacitor) {
            if (window.AndroidBridge) {
                window.AndroidBridge.saveFile(json, filename);
            } else {
                this._mostrarExportTexto(json);
            }
            return;
        }
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try { await navigator.share({ title: 'Copia EMT - Movilidad', files: [file] }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.share) {
            try { await navigator.share({ title: 'Copia EMT - Movilidad', text: json }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
            this._mostrarToast('✅ Copia exportada', 3000);
            return;
        } catch(_) {}
        this._mostrarExportTexto(json);
    },

    async importarDatos() {
        if (!this.usuarioActual) return;
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json';
        input.style.cssText = 'position:fixed;top:-100px;left:-100px;opacity:0;';
        document.body.appendChild(input);
        input.addEventListener('change', async (e) => {
            document.body.removeChild(input);
            const file = e.target.files[0]; if (!file) return;
            try {
                const datos = JSON.parse(await file.text());
                if (datos.horasTrabajadas === undefined || !datos.historial) { alert('❌ Archivo no válido.'); return; }
                const historialObj = {};
                if (Array.isArray(datos.historial)) datos.historial.forEach(({ id, ...rest }) => { historialObj[id] = rest; });
                else Object.assign(historialObj, datos.historial);
                const restored = { horasTrabajadas: datos.horasTrabajadas, historial: historialObj };
                await this._writeDriveFile(restored);
                if (datos.horasAnuales) { this.horasAnualesCustom = datos.horasAnuales; localStorage.setItem('horasAnuales', datos.horasAnuales); }
                this.actualizarUI(restored);
                await this._notificarBackup('💾 Copia restaurada', 'Los datos se han importado correctamente');
            } catch(err) { alert('❌ Error al leer el archivo: ' + err.message); }
        });
        input.click();
    },

    async cerrarSesion() {
        if (this.accessToken) {
            fetch('https://oauth2.googleapis.com/revoke?token=' + this.accessToken, { method: 'POST' }).catch(() => {});
        }
        this.accessToken   = null;
        this.tokenExpiry   = 0;
        this.refreshToken  = null;
        this.usuarioActual = null;
        localStorage.removeItem('gAccessToken');
        localStorage.removeItem('gTokenExpiry');
        localStorage.removeItem('gRefreshToken');
        localStorage.removeItem('gUserEmail');
        localStorage.removeItem('driveFileId');
        localStorage.removeItem('pkceVerifier');
        localStorage.removeItem('avatarPhoto');
        localStorage.removeItem('avatarEmoji');
        localStorage.removeItem('avatarBg');
        this.driveFileId = null;
        this.mostrarAuth();
    },

    actualizarBotonesPerfil() {
        const btn = document.getElementById('profileBtn');
        if (!btn) return;
        const photo = localStorage.getItem('avatarPhoto');
        const emoji = localStorage.getItem('avatarEmoji');
        const bg    = localStorage.getItem('avatarBg') || '#1565C0';
        btn.style.cssText = '';
        if (photo) {
            btn.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            btn.style.background = 'transparent'; btn.style.padding = '0'; btn.style.overflow = 'hidden';
        } else if (emoji) {
            btn.textContent = emoji; btn.style.background = bg; btn.style.fontSize = '20px'; btn.style.color = 'white';
        } else {
            const email   = this.usuarioActual?.email || '';
            const name    = this.usuarioActual?.name  || email;
            const palette = ['#667eea','#764ba2','#e74c3c','#27ae60','#f39c12','#3498db'];
            btn.textContent = name.charAt(0).toUpperCase();
            btn.style.background = palette[email.charCodeAt(0) % palette.length];
            btn.style.color = 'white'; btn.style.fontSize = '16px';
        }
    },

    _buildAvatarGrid() {
        const grid = document.getElementById('avatarGrid');
        if (!grid) return;
        grid.innerHTML = '';
        AVATAR_EMOJIS.forEach((emoji, i) => {
            const btn = document.createElement('button');
            btn.className = 'avatar-option'; btn.textContent = emoji; btn.style.background = AVATAR_BG[i];
            btn.addEventListener('click', () => this._seleccionarEmojiAvatar(emoji, AVATAR_BG[i]));
            grid.appendChild(btn);
        });
    },

    _seleccionarEmojiAvatar(emoji, bg) {
        localStorage.setItem('avatarEmoji', emoji); localStorage.setItem('avatarBg', bg); localStorage.removeItem('avatarPhoto');
        document.getElementById('avatarPickerModal').classList.remove('show');
        this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
        this._guardarPreferencias();
    },

    mostrarAvatarPicker() {
        document.getElementById('avatarPickerModal').classList.add('show');
        if (this.darkMode) document.getElementById('avatarModalContent').classList.add('dark');
        const btn = document.getElementById('googlePhotoBtn');
        if (btn) btn.style.display = this.usuarioActual?.picture ? '' : 'none';
    },

    usarFotoGoogle() {
        const url = this.usuarioActual?.picture;
        if (!url) return;
        const largeUrl = url.replace(/=s\d+(-c)?$/, '=s200-c');
        const apply = (src) => {
            localStorage.setItem('avatarPhoto', src);
            localStorage.removeItem('avatarEmoji');
            document.getElementById('avatarPickerModal').classList.remove('show');
            this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
            this._guardarPreferencias();
        };
        if (window.AndroidBridge?.fetchImageBase64) {
            // Descarga via Java para evitar restricciones CORS del WebView
            const cb = '_gphoto_' + Date.now();
            window[cb] = (data) => { delete window[cb]; apply(data || largeUrl); };
            window.AndroidBridge.fetchImageBase64(largeUrl, cb);
        } else {
            apply(largeUrl);
        }
    },

    subirFotoPerfil() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = 80; canvas.height = 80;
                    canvas.getContext('2d').drawImage(img, 0, 0, 80, 80);
                    localStorage.setItem('avatarPhoto', canvas.toDataURL('image/jpeg', 0.85));
                    localStorage.removeItem('avatarEmoji');
                    document.getElementById('avatarPickerModal').classList.remove('show');
                    this.actualizarBotonesPerfil(); this._actualizarAvatarPreview();
                    this._guardarPreferencias();
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    _actualizarAvatarPreview() {
        const el = document.getElementById('profileAvatarPreview');
        if (!el) return;
        const photo = localStorage.getItem('avatarPhoto');
        const emoji = localStorage.getItem('avatarEmoji');
        const bg    = localStorage.getItem('avatarBg') || '#1565C0';
        if (photo) {
            el.innerHTML = `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            el.style.background = 'transparent';
        } else if (emoji) {
            el.textContent = emoji; el.style.background = bg; el.style.color = '';
        } else {
            const email   = this.usuarioActual?.email || '';
            const name    = this.usuarioActual?.name  || email;
            const palette = ['#667eea','#764ba2','#e74c3c','#27ae60','#f39c12','#3498db'];
            el.textContent = name.charAt(0).toUpperCase();
            el.style.background = palette[email.charCodeAt(0) % palette.length]; el.style.color = 'white';
        }
    },

    guardarPerfil() {
        this.actualizarBotonesPerfil();
        alert('✅ Perfil guardado');
    },

    establecerFechaHoy() {
        const hoy = new Date();
        const y = hoy.getFullYear();
        const m = String(hoy.getMonth() + 1).padStart(2, '0');
        const d = String(hoy.getDate()).padStart(2, '0');
        document.getElementById('fechaInput').value = `${y}-${m}-${d}`;
        document.getElementById('fechaInput').max   = `${y}-${m}-${d}`;
        this.comprobarFestivo();
    },

    actualizarFecha() {
        const opts = { weekday: 'long', day: 'numeric', month: 'long' };
        document.getElementById('fechaHoy').textContent = new Date().toLocaleDateString('es-ES', opts);
    },

    mostrarMensaje(msg, tipo) {
        const el = document.getElementById('auth' + (tipo === 'error' ? 'Error' : 'Success'));
        el.textContent = msg; el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 5000);
    },

    _hideSplash() {
        const el = document.getElementById('splashScreen');
        if (!el) return;
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 380);
    },

    mostrarAuth() {
        this._hideSplash();
        document.getElementById('authScreen').classList.remove('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.remove('active');
    },

    mostrarApp() {
        this._hideSplash();
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.add('active');
        document.getElementById('optionsScreen').classList.remove('active');
    },

    // Gestionar quién entra es cosa del administrador; al resto ni se le
    // ofrece, aunque el endpoint ya rechace sus cambios con un 403.
    _aplicarVisibilidadAdmin() {
        const esAdmin = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
        const sec = document.getElementById('sectionAcceso');
        if (sec) sec.style.display = esAdmin ? '' : 'none';
    },

    mostrarOpciones() {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        document.getElementById('horasAnualesDisplay').textContent = this.horasAnualesCustom + 'h';
        this._actualizarJornadaDisplay();
        this._actualizarConductorDisplay();
        this._aplicarVisibilidadAdmin();
        this._renderVacaciones();
        document.getElementById('perfilEmail').textContent = this.usuarioActual?.email || '';
        document.getElementById('perfilNombre').textContent = this.usuarioActual?.name || '';
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
        this._actualizarAvatarPreview();
        this._actualizarTemaUI();
        this._actualizarInfoCopia();
    },

    toggleSection(btn) { btn.closest('.ops-section').classList.toggle('open'); },

    _calcHorasNocturnas(inicio, fin) {
        if (!inicio || !fin) return 0;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let a = h1 * 60 + m1;
        let b = h2 * 60 + m2;
        if (b <= a) b += 1440;
        const windows = [[1260, 1440], [1440, 1800]];
        let mins = 0;
        windows.forEach(([ws, we]) => {
            mins += Math.max(0, Math.min(b, we) - Math.max(a, ws));
        });
        return Math.round(mins / 60 * 2) / 2;
    },

    calcularHorasPorTiempo() {
        const inicio = document.getElementById('horaInicio').value;
        const fin    = document.getElementById('horaFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('horasInput').value = horas;
        this._renderTramos();            // cambian las horas sin lugar
        const nocturnas = this._calcHorasNocturnas(inicio, fin);
        const nocheExtra = document.getElementById('nocheExtra');
        const nocheBtn   = document.querySelector('.noche-compact');
        // Auto-activate luna if start hour is in nocturnal range (21–06)
        const autoLuna = h1 >= 21 || h1 < 6;
        if (nocturnas > 0 || autoLuna) {
            document.getElementById('nocheToggle').checked = true;
            if (nocheBtn) nocheBtn.classList.add('active');
            nocheExtra.classList.add('visible');
            if (nocturnas > 0) {
                document.getElementById('horasNocturnas').value = nocturnas;
                if (this.precioNocheDefault > 0) document.getElementById('precioNoche').value = this.precioNocheDefault;
                this.calcularExtra();
            }
        } else {
            document.getElementById('nocheToggle').checked = false;
            if (nocheBtn) nocheBtn.classList.remove('active');
            nocheExtra.classList.remove('visible');
            document.getElementById('horasNocturnas').value = '';
            document.getElementById('nocheResumen').textContent = '';
        }
    },

    clickNocheCompact() {
        const cb = document.getElementById('nocheToggle');
        cb.checked = !cb.checked;
        document.querySelector('.noche-compact')?.classList.toggle('active', cb.checked);
        this.toggleNoche();
    },

    // PR = Permiso Retribuido. Two per calendar year, counted down as they are used.
    PR_ANUALES: 2,

    _prUsados(historial) {
        const año = new Date().getFullYear();
        return Object.values(historial || this._historialFull || {})
            .filter(r => r.pr && new Date(r.timestamp).getFullYear() === año).length;
    },

    _prRestantes(historial) {
        return Math.max(0, this.PR_ANUALES - this._prUsados(historial));
    },

    _actualizarPrUI() {
        const restantes = this._prRestantes();
        const el = document.getElementById('prRestantes');
        if (el) el.textContent = restantes;
        const btn = document.getElementById('prCompact');
        // Still tappable when exhausted (an old one may have been deleted), just dimmed
        if (btn) btn.classList.toggle('agotado', restantes === 0 && !this.prActivo);
    },

    clickPrCompact() {
        if (!this.prActivo && this._prRestantes() === 0) {
            alert(`❌ Ya has usado los ${this.PR_ANUALES} permisos retribuidos de este año`);
            return;
        }
        this.prActivo = !this.prActivo;
        document.getElementById('prCompact').classList.toggle('active', this.prActivo);
        document.getElementById('prToggle').checked = this.prActivo;
        this._actualizarPrUI();
    },

    clickFestivo() {
        this.festivoActivo = !this.festivoActivo;
        document.getElementById('festivoCompact').classList.toggle('active', this.festivoActivo);
        document.getElementById('festivoToggle').checked = this.festivoActivo;
        // Jornada completa: venir un festivo o un libre son sus horas de
        // jornada, pero solo como propuesta. Si escribe otras, mandan las suyas.
        const campo = document.getElementById('horasInput');
        if (this.festivoActivo && this._esJornadaCompleta() && campo
            && !(parseFloat(campo.value) > 0)) {
            campo.value = this.jornadaHoras;
        }
    },

    // El título del cuadro solo habla de días libres a quien puede trabajarlos
    _actualizarTituloFestivos() {
        const el = document.getElementById('statFestivosLabel');
        if (el) el.textContent = this._esJornadaCompleta()
            ? '🎉 Festivos/días libres' : '🎉 Festivos';
        const caja = document.getElementById('festivoCompact');
        if (caja) caja.title = this._esJornadaCompleta()
            ? 'Festivo o día libre trabajado' : 'Festivo';
    },

    // ── Vacaciones ───────────────────────────────────────────────────────────

    _getVacaciones() { return JSON.parse(localStorage.getItem('vacaciones') || '[]'); },

    _saveVacaciones(v, deGestion) {
        localStorage.setItem('vacaciones', JSON.stringify(v));
        // La marca de tiempo decide quién manda cuando el trabajador y el
        // gestor tocan las vacaciones por separado: gana el cambio más nuevo.
        if (!deGestion) localStorage.setItem('vacacionesAt', String(Date.now()));
        this._guardarPreferencias();
    },

    _vacacionesAt() { return parseInt(localStorage.getItem('vacacionesAt') || '0', 10); },

    // Los días de la semana también los puede cambiar el gestor desde el
    // cuadrante, así que van sellados para que gane el último cambio.
    _diasAt() { return parseInt(localStorage.getItem('diasSemanaAt') || '0', 10); },

    // Grupo de días libres de la jornada completa. Lo asigna gestión; aquí solo
    // se enseña.
    grupoDescanso: parseInt(localStorage.getItem('grupoDescanso') || '0', 10) || null,
    _sellarDias() { localStorage.setItem('diasSemanaAt', String(Date.now())); },

    _etiquetaDias() {
        const d = Array.isArray(this.diasSemana) && this.diasSemana.length ? this.diasSemana : null;
        if (!d) return 'todos';
        const letra = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
        return this.DIAS_MEDIA.filter(x => d.includes(x)).map(x => letra[x]).join(' ');
    },

    _hoyISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },

    _periodoVacacionesActivo() {
        const hoy = this._hoyISO();
        return this._getVacaciones().find(v => hoy >= v.desde && hoy <= v.hasta) || null;
    },

    _aplicarModoVacaciones() {
        const per = this._periodoVacacionesActivo();
        document.body.classList.toggle('vacaciones', !!per);
        const sub = document.getElementById('vacBannerSub');
        if (per && sub) {
            const fin  = new Date(per.hasta + 'T12:00:00');
            const dias = Math.max(0, Math.ceil((fin - new Date()) / 86400000));
            sub.textContent = dias === 0 ? 'Último día, a disfrutarlo'
                            : `Te quedan ${dias} día${dias === 1 ? '' : 's'}`;
        }
    },

    añadirVacaciones() {
        const desde = document.getElementById('vacDesde').value;
        const hasta = document.getElementById('vacHasta').value;
        if (!desde || !hasta) { this._mostrarToast('❌ Indica las dos fechas', 3000); return; }
        if (hasta < desde)    { this._mostrarToast('❌ La fecha final es anterior a la inicial', 3000); return; }
        const v = this._getVacaciones();
        v.push({ desde, hasta });
        v.sort((a, b) => a.desde.localeCompare(b.desde));
        this._saveVacaciones(v);
        document.getElementById('vacDesde').value = '';
        document.getElementById('vacHasta').value = '';
        this._renderVacaciones();
        this._aplicarModoVacaciones();
        this._mostrarToast('🏖️ Vacaciones añadidas', 2500);
    },

    borrarVacaciones(i) {
        const v = this._getVacaciones();
        v.splice(i, 1);
        this._saveVacaciones(v);
        this._renderVacaciones();
        this._aplicarModoVacaciones();
    },

    _renderVacaciones() {
        const cont = document.getElementById('vacList');
        if (!cont) return;
        const v = this._getVacaciones();
        if (!v.length) {
            cont.innerHTML = '<div class="ops-field-sub" style="padding-top:6px;">Sin vacaciones guardadas</div>';
            return;
        }
        const fmt = s => new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { day:'2-digit', month:'short' });
        const hoy = this._hoyISO();
        cont.innerHTML = v.map((p, i) => {
            const dias = Math.round((new Date(p.hasta) - new Date(p.desde)) / 86400000) + 1;
            const activo = hoy >= p.desde && hoy <= p.hasta;
            return `<div class="vac-item">
                <span class="vac-item-txt">${activo ? '🏖️ ' : ''}${fmt(p.desde)} → ${fmt(p.hasta)}
                    <span class="vac-item-n">(${dias} día${dias===1?'':'s'})</span></span>
                <button class="vac-del" onclick="app.borrarVacaciones(${i})">×</button>
            </div>`;
        }).join('');
    },

    // ── Exportar mis jornadas ────────────────────────────────────────────────
    // Solo las jornadas de quien usa la app: aquí no hay nadie más
    _filasExport() {
        const filas = [];
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            const f = this._fechaDeId(id);
            const lugar = r.puesto || this.puestoTrabajo || '';
            const t = this._turnoDe(lugar, r.horaInicio) || '';
            filas.push({
                fecha: `${f.slice(6,8)}/${f.slice(4,6)}/${f.slice(0,4)}`,
                orden: f, clugar: this._clavePuesto(lugar),
                num: this.numConductor || '', nombre: this.usuarioActual?.name || '',
                puesto: lugar, turno: { M:'Mañana', T:'Tarde', N:'Noche' }[t] || '',
                ini: r.horaInicio || '', fin: r.horaFin || '',
                horas: parseFloat(r.horas) || 0, noct: r.horasNocturnas || 0,
                extra: r.extraDestino === 'extras' ? 'Sí' : '', festivo: r.festivo ? 'Sí' : '',
                vac: r.vacaciones ? 'Sí' : '', pr: r.pr ? 'Sí' : '',
                be: r.be ? 'Sí' : '',
                nota: r.nota || '',
            });
        });
        // Por fecha y, dentro del mismo día, por hora de entrada. Las jornadas
        // sin horario (vacaciones, festivos no trabajados) van al final del día.
        const entrada = x => x.ini || '99:99';
        filas.sort((a, b) => a.orden.localeCompare(b.orden) || entrada(a).localeCompare(entrada(b)));
        const g = this._filtrosExport();
        return filas.filter(r =>
               (!g.desde || r.orden >= g.desde)
            && (!g.hasta || r.orden <= g.hasta)
            && (!g.lugares || g.lugares.includes(r.clugar)));
    },

    // Todas las jornadas, sin filtrar: es contra lo que se ofrecen las opciones
    _filasTodas() {
        const guardado = this._filtros;
        this._filtros = { desde:'', hasta:'', lugares:null };
        try { return this._filasExport(); } finally { this._filtros = guardado; }
    },

    // Lista vacía = sin jornadas; null = sin filtro (todas)
    _filtrosExport() {
        if (this._filtros) return this._filtros;
        let g = null;
        try { g = JSON.parse(localStorage.getItem('filtrosExportMio') || 'null'); } catch (_) {}
        this._filtros = {
            desde: typeof g?.desde === 'string' ? g.desde : '',
            hasta: typeof g?.hasta === 'string' ? g.hasta : '',
            lugares: Array.isArray(g?.lugares) ? g.lugares : null,
        };
        return this._filtros;
    },

    _guardarFiltros(cambios) {
        this._filtros = { ...this._filtrosExport(), ...cambios };
        localStorage.setItem('filtrosExportMio', JSON.stringify(this._filtros));
        this._renderFiltrosExport();
        this._renderColsExport();
    },

    // Cada opción del selector es una o varias columnas de la hoja
    COLUMNAS_EXPORT: [
        { id:'fecha',      etiqueta:'Fecha completa',        cabeceras:['Fecha'],                  valores:f => [f.fecha] },
        { id:'trabajador', etiqueta:'Trabajador',            cabeceras:['Nº trabajador','Nombre'], valores:f => [f.num, f.nombre] },
        { id:'turno',      etiqueta:'Mañana, tarde o noche', cabeceras:['Turno'],                  valores:f => [f.turno] },
        { id:'lugar',      etiqueta:'Lugar de trabajo',      cabeceras:['Lugar de trabajo'],       valores:f => [f.puesto] },
        { id:'horarios',   etiqueta:'Horarios',              cabeceras:['Entrada','Salida'],       valores:f => [f.ini, f.fin] },
        { id:'horas',      etiqueta:'Horas',                 cabeceras:['Horas'],                  valores:f => [f.horas] },
        { id:'nocturnas',  etiqueta:'Horas nocturnas',       cabeceras:['Nocturnas'],              valores:f => [f.noct] },
        { id:'extras',     etiqueta:'Horas extras',          cabeceras:['Extra'],                  valores:f => [f.extra] },
        { id:'festivos',   etiqueta:'Festivos',              cabeceras:['Festivo'],                valores:f => [f.festivo] },
        { id:'vacaciones', etiqueta:'Vacaciones',            cabeceras:['Vacaciones'],             valores:f => [f.vac] },
        { id:'pr',         etiqueta:'PR',                    cabeceras:['PR'],                     valores:f => [f.pr] },
        { id:'be',         etiqueta:'BE',                    cabeceras:['BE'],                     valores:f => [f.be] },
        { id:'nota',       etiqueta:'Notas de la jornada',   cabeceras:['Nota'],                   valores:f => [f.nota] },
    ],

    _colsElegidas() {
        let guardadas = null;
        try { guardadas = JSON.parse(localStorage.getItem('colsExportMias') || 'null'); } catch (_) {}
        const ids = this.COLUMNAS_EXPORT.map(c => c.id);
        // Sin elección previa se exporta todo, como antes. Una lista vacía sí es
        // una elección: desmarcar "Todo" tiene que dejar las casillas vacías.
        if (!Array.isArray(guardadas)) return ids;
        return guardadas.filter(id => ids.includes(id));
    },

    _colsActivas() {
        const elegidas = this._colsElegidas();
        return this.COLUMNAS_EXPORT.filter(c => elegidas.includes(c.id));
    },

    get CABECERAS_EXPORT() { return this._colsActivas().flatMap(c => c.cabeceras); },

    _valoresFila(f) { return this._colsActivas().flatMap(c => c.valores(f)); },

    // Los tres filtros comparten estructura: cabecera plegable con un resumen
    // de lo elegido, y dentro las opciones.
    _renderFiltrosExport() {
        const cont = document.getElementById('expFiltros');
        if (!cont) return;
        const f = this._filtrosExport();
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const iso = v => v ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : '';
        const corta = v => v ? `${v.slice(6,8)}/${v.slice(4,6)}/${v.slice(0,4)}` : '';

        const todas = this._filasTodas();
        const lugares = [...new Map(todas.map(r => [r.clugar, r.puesto || 'Sin lugar'])).entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'es'));

        const resumenFechas = (!f.desde && !f.hasta) ? 'Todas'
            : `${corta(f.desde) || '…'} – ${corta(f.hasta) || '…'}`;
        const resumen = (sel, total) => !sel ? 'Todos'
            : sel.length === total ? 'Todos' : `${sel.length} de ${total}`;

        const casillas = (grupo, items) => {
            const sel = f[grupo];
            const todo = !sel || sel.length === items.length;
            return `<label class="exp-col exp-todo">
                    <input type="checkbox" ${todo ? 'checked' : ''}
                           onchange="app._todoFiltro('${grupo}', this.checked)"><span>Todos</span></label>`
                + items.map(([valor, etiqueta]) => `<label class="exp-col">
                    <input type="checkbox" data-grupo="${grupo}" value="${esc(valor)}"
                           ${(!sel || sel.includes(valor)) ? 'checked' : ''}
                           onchange="app._marcarFiltro('${grupo}')"><span>${esc(etiqueta)}</span></label>`).join('');
        };

        cont.innerHTML = `
        <div class="exp-sec${this._secExp === 'fechas' ? ' abierta' : ''}">
            <div class="exp-sec-h" onclick="app._abrirSecExport('fechas')">
                <span class="exp-sec-t">📅 Días</span>
                <span class="exp-sec-r">${esc(resumenFechas)}</span><span class="exp-sec-c">▾</span>
            </div>
            <div class="exp-sec-b">
                <div class="exp-fechas">
                    <label>Desde<input type="date" value="${iso(f.desde)}"
                        onchange="app._guardarFiltros({desde:this.value.replace(/-/g,'')})"></label>
                    <label>Hasta<input type="date" value="${iso(f.hasta)}"
                        onchange="app._guardarFiltros({hasta:this.value.replace(/-/g,'')})"></label>
                </div>
                <div class="exp-chips">
                    <button onclick="app._rangoRapido('todo')">Todo</button>
                    <button onclick="app._rangoRapido('mes')">Este mes</button>
                    <button onclick="app._rangoRapido('anterior')">Mes anterior</button>
                    <button onclick="app._rangoRapido('anio')">Este año</button>
                </div>
            </div>
        </div>
        <div class="exp-sec${this._secExp === 'lugar' ? ' abierta' : ''}">
            <div class="exp-sec-h" onclick="app._abrirSecExport('lugar')">
                <span class="exp-sec-t">🧩 Lugares de trabajo</span>
                <span class="exp-sec-r">${resumen(f.lugares, lugares.length)}</span><span class="exp-sec-c">▾</span>
            </div>
            <div class="exp-sec-b">${casillas('lugares', lugares)}</div>
        </div>`;
    },

    _abrirSecExport(id) {
        this._secExp = this._secExp === id ? null : id;   // solo una abierta a la vez
        this._renderFiltrosExport();
    },

    _rangoRapido(cual) {
        const hoy = new Date();
        const cl = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
        if (cual === 'todo')  return this._guardarFiltros({ desde:'', hasta:'' });
        if (cual === 'anio')  return this._guardarFiltros({
            desde: cl(new Date(hoy.getFullYear(), 0, 1)), hasta: cl(new Date(hoy.getFullYear(), 11, 31)) });
        const m = hoy.getMonth() - (cual === 'anterior' ? 1 : 0);
        this._guardarFiltros({
            desde: cl(new Date(hoy.getFullYear(), m, 1)),
            hasta: cl(new Date(hoy.getFullYear(), m + 1, 0)) });
    },

    _marcarFiltro(grupo) {
        const todos = [...document.querySelectorAll(`#expFiltros input[data-grupo="${grupo}"]`)];
        const sel = todos.filter(i => i.checked).map(i => i.value);
        // Marcado entero equivale a "sin filtro": así una lista que crezca sigue entrando
        this._guardarFiltros({ [grupo]: sel.length === todos.length ? null : sel });
    },

    _todoFiltro(grupo, marcar) { this._guardarFiltros({ [grupo]: marcar ? null : [] }); },

    _renderColsExport() {
        const cont = document.getElementById('expCols');
        if (!cont) return;
        const elegidas = this._colsElegidas();
        const todo = elegidas.length === this.COLUMNAS_EXPORT.length;
        cont.innerHTML = `<label class="exp-col exp-todo">
                <input type="checkbox" ${todo ? 'checked' : ''} onchange="app._marcarTodoExport(this.checked)">
                <span>Todo</span></label>`
            + this.COLUMNAS_EXPORT.map(c => `<label class="exp-col">
                <input type="checkbox" value="${c.id}" ${elegidas.includes(c.id) ? 'checked' : ''}
                       onchange="app._guardarColsExport()">
                <span>${c.etiqueta}</span></label>`).join('');
        const n = this._filasExport().length;
        const pie = document.getElementById('expResumen');
        if (pie) pie.textContent = n === 1 ? '1 jornada seleccionada' : `${n} jornadas seleccionadas`;
    },

    _guardarColsExport() {
        const ids = [...document.querySelectorAll('#expCols input[value]')]
            .filter(i => i.checked).map(i => i.value);
        localStorage.setItem('colsExportMias', JSON.stringify(ids));
        this._renderColsExport();
    },

    _marcarTodoExport(marcar) {
        localStorage.setItem('colsExportMias', JSON.stringify(
            marcar ? this.COLUMNAS_EXPORT.map(c => c.id) : []));
        this._renderColsExport();
    },

    // Una hoja sin columnas no sirve de nada: mejor avisar que generarla vacía
    _hayColumnas() {
        if (!this._colsElegidas().length) {
            this._mostrarToast('Elige al menos un dato que exportar', 3000); return false;
        }
        if (!this._filasExport().length) {
            this._mostrarToast('Ninguna jornada pasa los filtros', 3000); return false;
        }
        return true;
    },

    exportarRegistro() {
        if (!this._filasExport().length) { this._mostrarToast('No hay jornadas que exportar', 3000); return; }
        this._secExp = null;
        this._renderFiltrosExport();
        this._renderColsExport();
        document.getElementById('expModal').classList.add('show');
        if (this.darkMode) document.getElementById('expModalContent').classList.add('dark');
    },

    _nombreExport(ext) { return `mis-jornadas-${this.numConductor || 'emt'}-${new Date().toISOString().slice(0,10)}.${ext}`; },

    _descargar(contenido, nombre, tipo) {
        if (window.AndroidBridge?.saveFile) { window.AndroidBridge.saveFile(contenido, nombre); return; }
        const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    // ── Excel de verdad (.xlsx) ─────────────────────────────────────────────
    // Antes se guardaba una tabla HTML con extensión .xls. Excel de escritorio
    // la tragaba, pero Office en Android la rechaza con "este archivo no es
    // compatible". Un .xlsx es un ZIP con unos cuantos XML dentro, así que se
    // arma a mano: sin comprimir (método 0) basta y evita meter una librería.

    _crc32(bytes) {
        let tabla = this._crcTabla;
        if (!tabla) {
            tabla = this._crcTabla = new Int32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                tabla[n] = c;
            }
        }
        let crc = -1;
        for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ tabla[(crc ^ bytes[i]) & 0xFF];
        return (crc ^ -1) >>> 0;
    },

    _zip(ficheros) {
        const enc = new TextEncoder();
        const partes = [], central = [];
        let offset = 0;
        const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
        const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

        ficheros.forEach(({ nombre, texto }) => {
            const datos = enc.encode(texto);
            const nom   = enc.encode(nombre);
            const crc   = this._crc32(datos);
            // Bit 11 = nombres en UTF-8; fecha y hora fijas, no aportan nada aquí
            const comun = [...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(0x2100),
                           ...u32(crc), ...u32(datos.length), ...u32(datos.length),
                           ...u16(nom.length)];
            partes.push(new Uint8Array([...u32(0x04034b50), ...comun, ...u16(0)]), nom, datos);
            // extra, comentario, disco, atributos internos, atributos externos, offset
            central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...comun,
                ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nom);
            offset += 30 + nom.length + datos.length;
        });

        const tamCentral = central.reduce((n, p) => n + p.length, 0);
        const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0),
            ...u16(ficheros.length), ...u16(ficheros.length),
            ...u32(tamCentral), ...u32(offset), ...u16(0)]);

        const todo = [...partes, ...central, fin];
        const total = todo.reduce((n, p) => n + p.length, 0);
        const salida = new Uint8Array(total);
        let i = 0;
        todo.forEach(p => { salida.set(p, i); i += p.length; });
        return salida;
    },

    _colExcel(n) {                       // 0 -> A, 25 -> Z, 26 -> AA
        let s = '';
        for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
        return s;
    },

    _xlsxRegistro() {
        const esc = v => String(v ?? '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        const cabeceras = this.CABECERAS_EXPORT;
        const filas = this._filasExport().map(f => this._valoresFila(f));

        const celda = (v, col, fila, estilo) => {
            const ref = `${this._colExcel(col)}${fila}`;
            const st  = estilo ? ` s="${estilo}"` : '';
            if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
            const t = esc(v);
            if (t === '') return '';
            return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`;
        };

        const filasXml = [
            `<row r="1">${cabeceras.map((h, i) => celda(h, i, 1, 1)).join('')}</row>`,
            ...filas.map((vals, n) => `<row r="${n + 2}">${vals.map((v, i) => celda(v, i, n + 2, 0)).join('')}</row>`),
        ].join('');

        const ancho = cabeceras.map((h, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${Math.min(34, Math.max(9, h.length + 4))}" customWidth="1"/>`).join('');

        const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
        const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
        const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
        const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

        return this._zip([
            { nombre: '[Content_Types].xml', texto: X
            + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
            + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
            + `<Default Extension="xml" ContentType="application/xml"/>`
            + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
            + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
            + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
            + `</Types>` },
            { nombre: '_rels/.rels', texto: X
            + `<Relationships xmlns="${REL}">`
            + `<Relationship Id="rId1" Type="${DOC}/officeDocument" Target="xl/workbook.xml"/>`
            + `</Relationships>` },
            { nombre: 'xl/workbook.xml', texto: X
            + `<workbook xmlns="${NS}" xmlns:r="${DOC}">`
            + `<sheets><sheet name="Registro" sheetId="1" r:id="rId1"/></sheets></workbook>` },
            { nombre: 'xl/_rels/workbook.xml.rels', texto: X
            + `<Relationships xmlns="${REL}">`
            + `<Relationship Id="rId1" Type="${DOC}/worksheet" Target="worksheets/sheet1.xml"/>`
            + `<Relationship Id="rId2" Type="${DOC}/styles" Target="styles.xml"/>`
            + `</Relationships>` },
            { nombre: 'xl/styles.xml', texto: X
            + `<styleSheet xmlns="${NS}">`
            + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>`
            + `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`
            + `<fills count="3"><fill><patternFill patternType="none"/></fill>`
            + `<fill><patternFill patternType="gray125"/></fill>`
            + `<fill><patternFill patternType="solid"><fgColor rgb="FF1565C0"/><bgColor indexed="64"/></patternFill></fill></fills>`
            + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
            + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
            + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
            + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`
            + `</styleSheet>` },
            { nombre: 'xl/worksheets/sheet1.xml', texto: X
            + `<worksheet xmlns="${NS}">`
            + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
            + `<cols>${ancho}</cols><sheetData>${filasXml}</sheetData></worksheet>` },
        ]);
    },

    _descargarBinario(bytes, nombre, tipo) {
        if (window.AndroidBridge?.saveFileBase64) {
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            window.AndroidBridge.saveFileBase64(btoa(bin), nombre);
            return true;
        }
        if (window.AndroidBridge?.saveFile) return false;   // versión antigua sin el puente
        const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
        const a = document.createElement('a');
        a.href = url; a.download = nombre; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        return true;
    },

    // Separador ; y coma decimal: es lo que espera Excel en español.
    // El BOM hace que reconozca los acentos.
    _csvRegistro() {
        const esc = v => {
            const t = String(v ?? '');
            return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        };
        const lineas = [this.CABECERAS_EXPORT.join(';')];
        this._filasExport().forEach(f => lineas.push(
            this._valoresFila(f).map(v => esc(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';')));
        return '﻿' + lineas.join('\r\n') + '\r\n';
    },

    exportarCSV() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        this._descargar(this._csvRegistro(), this._nombreExport('csv'), 'text/csv;charset=utf-8;');
        this._mostrarToast(`📊 ${filas.length} jornadas en CSV`, 4000);
    },

    exportarXLS() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        const ok = this._descargarBinario(this._xlsxRegistro(), this._nombreExport('xlsx'),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (!ok) { this._mostrarToast('Actualiza la app para exportar a Excel; de momento usa CSV', 4500); return; }
        this._mostrarToast(`📗 ${filas.length} jornadas en Excel`, 4000);
    },

    // Drive convierte un CSV en hoja de cálculo si se le pide ese mimeType
    async exportarSheets() {
        if (!this._hayColumnas()) return;
        document.getElementById('expModal').classList.remove('show');
        const filas = this._filasExport();
        this._mostrarToast('☁️ Creando hoja en Drive...', 3000);
        try {
            if (!await this._ensureToken()) throw new Error('Sin sesión de Google');
            const frontera = '-------emt' + Date.now();
            const meta = JSON.stringify({
                name: `Mis jornadas EMT ${new Date().toISOString().slice(0,10)}`,
                mimeType: 'application/vnd.google-apps.spreadsheet',
            });
            const cuerpo = `\r\n--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}`
                + `\r\n--${frontera}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${this._csvRegistro()}`
                + `\r\n--${frontera}--`;
            const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.accessToken}`,
                           'Content-Type': `multipart/related; boundary=${frontera}` },
                body: cuerpo,
            });
            if (!resp.ok) throw new Error('Drive ' + resp.status);
            const r = await resp.json();
            this._mostrarToast(`✅ ${filas.length} jornadas en Google Sheets`, 4000);
            if (r.webViewLink) {
                if (window.AndroidBridge?.openExternalUrl) window.AndroidBridge.openExternalUrl(r.webViewLink);
                else window.open(r.webViewLink, '_blank');
            }
        } catch (e) {
            this._mostrarToast('❌ No se pudo crear la hoja: ' + e.message, 4500);
        }
    },

    // ── Notas ───────────────────────────────────────────────────────────────
    // El trabajador escribe y gestión contesta. La fecha y la hora las pone el
    // servidor, para que no dependan del reloj del móvil.

    NOTAS_URL: 'https://registro-horario-emt.vercel.app/api/notas',
    _notas: [],

    async _cargarNotas() {
        if (!this.usuarioActual?.email) return;
        try {
            const r = await fetch(`${this.NOTAS_URL}?email=${encodeURIComponent(this.usuarioActual.email)}`,
                { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            this._notas = await r.json();
            localStorage.setItem('notasCache', JSON.stringify(this._notas));
        } catch (_) {
            // Sin red se enseña lo último que se vio
            try { this._notas = JSON.parse(localStorage.getItem('notasCache') || '[]'); } catch (__) {}
        }
        this._renderNotas();
        // Con la conversación abierta, lo que llegue se ve ahí mismo: antes
        // había que cerrarla y volver a entrar para leer la respuesta.
        if (this._hiloAbierto
            && document.getElementById('hiloModal')?.classList.contains('show')) {
            this._marcarLeida(this._hiloAbierto);
            this._renderHilo();
        }
        this._avisarSiHayNuevos();
        this._atenderChatPendiente();
        this._iniciarSondeoChat();     // idempotente: reinicia el que hubiera
    },

    _fechaNota(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    _renderNotas() {
        const cont = document.getElementById('ntLista');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const verArchivadas = localStorage.getItem('verArchivadas') === '1';
        const todas = this._notas || [];
        const lista = todas.filter(n => !!n.archivada === verArchivadas);
        const nArch = todas.filter(n => n.archivada).length;
        const barra = document.getElementById('ntArchivadas');
        if (barra) {
            barra.innerHTML = `<button class="${verArchivadas ? '' : 'activo'}"
                    onclick="app._verArchivadas(false)">Bandeja ${todas.length - nArch}</button>
                <button class="${verArchivadas ? 'activo' : ''}"
                    onclick="app._verArchivadas(true)">Archivadas ${nArch}</button>`;
        }
        if (!lista.length) {
            cont.innerHTML = `<div class="nt-vacio">${verArchivadas
                ? 'No has archivado ninguna conversación.'
                : 'Todavía no hay conversaciones.'}</div>`;
            return;
        }
        const etiqueta = { visto: 'Vista', pendiente: 'Sin ver' };
        cont.innerHTML = lista.map(n => {
            const ultimo = this._ultimoMensaje(n);
            const clase = n.tipo === 'companero' ? 'companero'
                : this._estaVista(n) ? 'visto' : '';
            const q = esc(n.id).replace(/'/g, "\\'");
            const nueva = this._sinLeer(n);
            return `<div class="cv-card ${clase}${n.archivada ? ' archivada' : ''}${nueva ? ' nueva' : ''}"
                    onclick="app.abrirHilo('${q}')">
                <div class="cv-top">
                    ${nueva ? '<span class="cv-punto"></span>' : ''}
                    <span class="cv-quien">${esc(this._tituloHilo(n))}</span>
                    <span class="cv-fecha">${esc(this._horaCorta(ultimo?.en || n.creado))}</span>
                </div>
                <div class="cv-ultimo">${ultimo ? esc(
                    (this._esMiMensaje(ultimo, n) ? 'Tú: ' : '') + (ultimo.texto || '📎 Adjunto')) : ''}</div>
                <div class="cv-pie">
                    <span class="cv-cnt">${this._mensajesDe(n).length} mensaje${
                        this._mensajesDe(n).length === 1 ? '' : 's'}</span>
                    <span class="cv-cnt">${etiqueta[this._estaVista(n) ? 'visto' : 'pendiente']}</span>
                    <span class="cv-acc" onclick="event.stopPropagation()">
                        <button onclick="app._archivarHilo('${q}',${!n.archivada})">${
                            n.archivada ? 'Recuperar' : 'Archivar'}</button>
                        <button class="borrar" onclick="app._borrarHilo('${q}')">Borrar</button>
                    </span>
                </div>
            </div>`;
        }).join('');
        this._pintarCampana();
    },

    _verArchivadas(si) {
        localStorage.setItem('verArchivadas', si ? '1' : '0');
        this._renderNotas();
    },

// Un adjunto de imagen se ve; lo demás se descarga
    _pintarAdjuntos(lista) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        if (!Array.isArray(lista) || !lista.length) return '';
        return `<div class="nt-adj">` + lista.map(a => a.tipo?.startsWith('image/')
            ? `<img src="${esc(a.datos)}" alt="${esc(a.nombre)}" onclick="app._verFoto('${esc(a.datos)}')">`
            : `<a href="${esc(a.datos)}" download="${esc(a.nombre)}">📎 ${esc(a.nombre)}</a>`).join('') + `</div>`;
    },

    _verFoto(datos) {
        const v = document.getElementById('fotoVisor');
        if (!v) { window.open(datos, '_blank'); return; }
        document.getElementById('fotoVisorImg').src = datos;
        v.classList.add('show');
    },

    // ── A quién va el mensaje: a gestión o a un compañero ────────────────────
    _destino: null,          // null = gestión
    _directorio: [],

    async elegirDestinatario() {
        document.getElementById('destBuscar').value = '';
        this._renderDestinatarios();
        document.getElementById('destModal').classList.add('show');
        if (this.darkMode) document.getElementById('destModalContent').classList.add('dark');
        if (!this._directorio.length) {
            try {
                const r = await fetch(`${this.USUARIOS_URL}?directorio=1`, { cache: 'no-store' });
                if (r.ok) {
                    this._directorio = await r.json();
                    localStorage.setItem('directorio', JSON.stringify(this._directorio));
                }
            } catch (_) {
                try { this._directorio = JSON.parse(localStorage.getItem('directorio') || '[]'); } catch (__) {}
            }
            this._renderDestinatarios();
        }
    },

    _renderDestinatarios() {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const q = (document.getElementById('destBuscar')?.value || '').toLowerCase().trim();
        const mio = (this.usuarioActual?.email || '').toLowerCase();
        const lista = this._directorio
            .filter(u => (u.email || '').toLowerCase() !== mio)     // a uno mismo, no
            .filter(u => !q || `${u.conductor || ''} ${u.nombre || ''}`.toLowerCase().includes(q));
        const fila = (email, num, nombre) => `<div class="dest-fila"
            onclick="app._ponerDestino(${email === null ? 'null' : `'${esc(email).replace(/'/g, "\\'")}'`})">
            <span class="nt-num">${esc(num)}</span>
            <span class="nt-nom">${esc(nombre)}</span></div>`;
        document.getElementById('destLista').innerHTML =
            fila(null, '🛠️', 'Gestión')
            + (lista.length ? lista.map(u => fila(u.email, u.conductor || '—', u.nombre || u.email)).join('')
               : `<div class="baja-vacio">${q ? 'Ningún compañero con ese nombre o número'
                    : 'Todavía no hay más compañeros'}</div>`);
    },

    _ponerDestino(email) {
        this._destino = email ? this._directorio.find(u => u.email === email) || { email } : null;
        document.getElementById('destModal').classList.remove('show');
        this._pintarDestino();
    },

    _pintarDestino() {
        const b = document.getElementById('ntParaBtn');
        const e = document.getElementById('ntEnviar');
        const d = this._destino;
        if (b) b.textContent = (d ? `${d.conductor ? d.conductor + ' · ' : ''}${d.nombre || d.email}` : 'Gestión') + ' ▾';
        if (e) e.textContent = d ? '📨 Enviar al compañero' : '📨 Enviar a gestión';
    },

    // ── Estar al tanto de los mensajes ───────────────────────────────────────
    // Sin esto las notas solo se recargaban al cambiar de pestaña o al volver
    // a la app: una respuesta podía estar horas en el servidor sin que saltara
    // nada. Ahora se pregunta cada poco, pero solo por la huella —un id y la
    // hora del último mensaje de cada conversación—, que ocupa nada. Los
    // mensajes enteros, con sus fotos, solo se bajan si algo ha cambiado.

    SONDEO_CHAT: 45 * 1000,
    _timerChat: null,
    _huellaChat: null,

    _iniciarSondeoChat() {
        this._pararSondeoChat();
        if (!this.usuarioActual?.email) return;
        this._timerChat = setInterval(() => this._sondearChat(), this.SONDEO_CHAT);
        // Y el aviso nativo, que es el que sigue mirando con la app de fondo:
        // el sondeo de aquí arriba solo vive mientras la pantalla esté viva.
        window.AndroidBridge?.activarAvisoChat?.(
            this.usuarioActual.email, false, this.NOTAS_URL);
    },

    // Hasta dónde he leído, para que el aviso nativo no repita lo ya visto
    _ponerAlDiaElAviso() {
        const visto = (this._notas || [])
            .filter(n => !this._sinLeer(n))
            .map(n => this._ultimoMensaje(n)?.en || '')
            .sort().pop();
        if (visto) window.AndroidBridge?.chatLeidoHasta?.(visto);
    },

    _pararSondeoChat() {
        clearInterval(this._timerChat);
        this._timerChat = null;
    },

    async _sondearChat() {
        if (!this.usuarioActual?.email || document.hidden) return;
        try {
            const r = await fetch(`${this.NOTAS_URL}?resumen=1&email=${encodeURIComponent(this.usuarioActual.email)}`, { cache: 'no-store' });
            if (!r.ok) return;
            const huella = JSON.stringify(await r.json());
            if (huella === this._huellaChat) return;    // nada nuevo, ni se baja
            this._huellaChat = huella;
            await this._cargarNotas();
        } catch (_) { /* sin red se reintenta al siguiente */ }
    },
    // ── Avisos del chat en la barra de Android ───────────────────────────────
    // Un aviso por conversación, que se actualiza si llegan más mensajes y se
    // retira al leerla. Desde él se puede contestar sin abrir la app, o
    // tocarlo para entrar directamente en esa conversación.

    _notificadas: {},          // id de conversación -> hora del último avisado
    _pendienteChat: null,      // lo que se pulsó antes de estar la sesión lista

    // Un id numérico estable por conversación, lejos del 1001 del aviso de
    // trabajo para que no se pisen.
    _idAviso(conv) {
        let h = 0;
        for (let i = 0; i < conv.length; i++) h = (h * 31 + conv.charCodeAt(i)) | 0;
        return 2000 + Math.abs(h % 90000);
    },

    async _setupNotifChat() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            await LN.registerActionTypes({
                types: [{
                    id: 'CHAT_MENSAJE',
                    actions: [
                        // input: true es la respuesta directa de Android, la que
                        // se escribe sin salir de la barra de notificaciones
                        { id: 'chat-responder', title: 'Responder', input: true,
                          inputPlaceholder: 'Escribe tu respuesta…', foreground: false },
                        { id: 'chat-leido', title: 'Marcar leído', foreground: false },
                    ],
                }],
            });
            LN.addListener('localNotificationActionPerformed', (ev) => {
                const conv = ev?.notification?.extra?.conv;
                if (!conv) return;                       // no es del chat
                if (ev.actionId === 'chat-responder' && (ev.inputValue || '').trim()) {
                    this._responderDesdeAviso(conv, ev.inputValue.trim());
                } else if (ev.actionId === 'chat-leido') {
                    this._marcarLeida(conv);
                    this._retirarAviso(conv);
                } else {
                    this._abrirDesdeAviso(conv);
                }
            });
        } catch (e) { console.error('acciones del chat:', e); }
    },

    // Puede llegar con la app recién abierta y sin sesión: se guarda y se
    // atiende en cuanto haya usuario.
    _abrirDesdeAviso(conv) {
        if (!this.usuarioActual) { this._pendienteChat = { abrir: conv }; return; }
        this.mostrarApp();
        this.switchTab(2);
        this._cargarNotas().then(() => this.abrirHilo(conv));
    },

    async _responderDesdeAviso(conv, texto) {
        if (!this.usuarioActual) { this._pendienteChat = { conv, texto }; return; }
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual.email || '' },
                body: JSON.stringify({ id: conv, texto,
                    ...(false ? { gestor: this._nombreGestor() }
                                   : { nombre: this.usuarioActual.name || '' }) }),
            });
            if (!r.ok) return;
            const data = await r.json();
            this._notas = (this._notas || []).map(x => x.id === data.id ? data : x);
            this._marcarLeida(conv);
            this._retirarAviso(conv);
            this._renderNotas();
        } catch (_) { /* sin red, se queda sin mandar */ }
    },

    _atenderChatPendiente() {
        const p = this._pendienteChat;
        if (!p || !this.usuarioActual) return;
        this._pendienteChat = null;
        if (p.abrir) this._abrirDesdeAviso(p.abrir);
        else this._responderDesdeAviso(p.conv, p.texto);
    },

    async _retirarAviso(conv) {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        delete this._notificadas[conv];
        try { await LN.cancel({ notifications: [{ id: this._idAviso(conv) }] }); } catch (_) {}
    },

    // Un aviso por conversación sin leer que no se haya avisado ya
    async _avisarEnLaBarra() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.schedule || !window.Capacitor?.isNativePlatform?.()) return;
        const pendientes = (this._notas || []).filter(n => !n.archivada && this._sinLeer(n));
        const vivas = new Set(pendientes.map(n => n.id));
        // Las que ya se han leído en otro sitio dejan de molestar
        Object.keys(this._notificadas).forEach(id => { if (!vivas.has(id)) this._retirarAviso(id); });

        const avisos = [];
        for (const n of pendientes) {
            const ultimo = this._ultimoMensaje(n);
            if (!ultimo || this._notificadas[n.id] === ultimo.en) continue;
            this._notificadas[n.id] = ultimo.en;
            avisos.push({
                id: this._idAviso(n.id),
                title: this._tituloHilo(n),
                body: ultimo.texto || '📎 Adjunto',
                actionTypeId: 'CHAT_MENSAJE',
                extra: { conv: n.id },
                ...(this.notifSoundChat && this.notifSoundChat !== 'ninguno'
                    && this.notifSoundChat !== 'default'
                    ? { channelId: this.notifSoundChat } : {}),
            });
        }
        if (!avisos.length) return;
        try { await LN.schedule({ notifications: avisos }); } catch (e) { console.error('aviso chat:', e); }
    },
    // ── Sin leer ─────────────────────────────────────────────────────────────
    // De cada conversación se guarda la hora del último mensaje que se ha
    // visto. Si llega uno más nuevo y no es mío, está sin leer. Va por móvil,
    // que es donde tiene sentido: lo leído en uno no lo ha leído el otro.

    notifSoundChat: localStorage.getItem('notifSoundChat') || 'default',

    _leidas() {
        try { return JSON.parse(localStorage.getItem('convLeidas') || '{}'); } catch (_) { return {}; }
    },

    _sinLeer(n) {
        const ultimo = this._ultimoMensaje(n);
        if (!ultimo || this._esMiMensaje(ultimo, n)) return false;
        return (ultimo.en || '') > (this._leidas()[n.id] || '');
    },

    _marcarLeida(id) {
        const n = (this._notas || []).find(x => x.id === id);
        const ultimo = this._ultimoMensaje(n);
        if (!ultimo) return;
        const l = this._leidas();
        l[id] = ultimo.en || new Date().toISOString();
        localStorage.setItem('convLeidas', JSON.stringify(l));
        this._retirarAviso(id);
        this._ponerAlDiaElAviso();
    },

    _totalSinLeer() {
        return (this._notas || []).filter(n => !n.archivada && this._sinLeer(n)).length;
    },

    _pintarCampana() {
        const el = document.getElementById('campanaN');
        if (!el) return;
        const n = this._totalSinLeer();
        el.textContent = n > 99 ? '99+' : String(n);
        el.classList.toggle('hay', n > 0);
    },

    irANotas() {
        this.switchTab(2);
    },

    guardarSonidoChat(sonido) {
        this.notifSoundChat = sonido;
        localStorage.setItem('notifSoundChat', sonido);
        this._guardarPreferencias();
        if (sonido !== 'ninguno') this._previewNotifSound(sonido);
    },

    // Suena una vez cuando aparece algo nuevo, no en cada repintado
    _avisarSiHayNuevos() {
        const n = this._totalSinLeer();
        const antes = this._sinLeerPrevio ?? n;
        this._sinLeerPrevio = n;
        if (n > antes && this.notifSoundChat !== 'ninguno') {
            try { this._previewNotifSound(this.notifSoundChat); } catch (_) {}
        }
        this._pintarCampana();
        this._avisarEnLaBarra();
    },
    // ── Conversaciones ───────────────────────────────────────────────────────
    // Una nota es un hilo: se abre, se lee entero y se contesta dentro, como
    // en cualquier chat. Se puede archivar para quitarla de en medio sin
    // perderla, o borrarla del todo.

    _hiloAbierto: null,

    _mensajesDe(n) { return Array.isArray(n?.mensajes) ? n.mensajes : []; },

    _ultimoMensaje(n) {
        const m = this._mensajesDe(n);
        return m.length ? m[m.length - 1] : null;
    },

    // Alinear a la derecha lo que he escrito yo
    _esMiMensaje(m, n) {
        if (false) return m.de === 'gestor';
        const mio = (this.usuarioActual?.email || '').toLowerCase();
        if ((m.de || '').toLowerCase() === mio) return true;
        return m.de === 'trabajador' && n.tipo !== 'companero'
            && (n.email || '').toLowerCase() === mio;
    },

    _tituloHilo(n) {
        if (n.tipo === 'companero') {
            const mio = (this.usuarioActual?.email || '').toLowerCase();
            const yoEmpecé = (n.deEmail || '').toLowerCase() === mio;
            return yoEmpecé ? (n.nombre || n.email) : (n.deNombre || n.deEmail);
        }
        if (false) return `${n.conductor ? n.conductor + ' · ' : ''}${n.nombre || n.email}`;
        return 'Gestión';
    },

    abrirHilo(id) {
        const n = (this._notas || []).find(x => x.id === id);
        if (!n) return;
        this._hiloAbierto = id;
        this._marcarLeida(id);
        document.getElementById('hiloTexto').value = '';
        document.getElementById('hiloQuien').textContent = this._tituloHilo(n);
        this._renderHilo();
        this._renderNotas();
        document.getElementById('hiloModal').classList.add('show');
        if (this.darkMode) document.getElementById('hiloModalContent').classList.add('dark');
    },

    _renderHilo() {
        const n = (this._notas || []).find(x => x.id === this._hiloAbierto);
        if (!n) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const cont = document.getElementById('hiloMensajes');
        cont.innerHTML = this._mensajesDe(n).map(m => {
            const mio = this._esMiMensaje(m, n);
            const adj = (m.adjuntos || []).map(a => a.tipo?.startsWith('image/')
                ? `<img src="${esc(a.datos)}" onclick="app._verFoto('${esc(a.datos)}')">`
                : `<a href="${esc(a.datos)}" download="${esc(a.nombre)}">📎 ${esc(a.nombre)}</a>`).join('');
            // Sin saltos ni sangría dentro del globo: el texto va con
            // pre-wrap, así que la propia plantilla se vería como líneas en
            // blanco.
            // El visto del gestor va centrado y sin globo: es un apunte del
            // sistema, no algo que haya escrito nadie.
            if (m.sistema) {
                return `<div class="bub sistema">${esc(m.texto)}`
                    + (m.autor ? ` · ${esc(m.autor)}` : '')
                    + ` · ${esc(this._horaCorta(m.en))}</div>`;
            }
            return `<div class="bub ${mio ? 'mio' : 'suyo'}">`
                + (mio ? '' : `<div class="bub-autor">${esc(m.autor) || (m.de === 'gestor' ? 'Gestión' : '')}</div>`)
                + `<span class="bub-txt">${esc(m.texto)}</span>${adj}`
                + `<div class="bub-hora">${esc(this._horaCorta(m.en))}</div></div>`;
        }).join('') || '<div class="nt-vacio">Sin mensajes</div>';
        // Quién le dio el visto y cuándo, para los dos lados por igual
        const v = n.vistoPor;
        if (v) {
            cont.innerHTML += `<div class="bub sistema">👁 Visto por ${esc(v.nombre) || esc(v.email)}`
                + ` · ${esc(this._horaCorta(v.en))}</div>`;
        }
        cont.scrollTop = cont.scrollHeight;
        this._renderPieHilo(n);
    },

    _horaCorta(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    },

    // El visto ya no es de gestión: lo da cualquiera de los dos y el otro lo
    // ve en su app. Por eso el botón está igual en las dos, y no hay forma de
    // denegar nada: una nota se lee, se contesta o se archiva.
    _estaVista(n) { return n?.estado === 'visto' || !!n?.vistoPor; },

    _renderPieHilo(n) {
        const pie = document.getElementById('hiloPie');
        if (!pie) return;
        const esc = t => String(t || '').replace(/'/g, "\\'");
        const visto = this._estaVista(n);
        pie.innerHTML = `<button class="modal-btn modal-btn-cancel" style="flex:0 0 auto;padding:10px 12px;"
                title="${visto ? 'Quitar el visto' : 'Darla por vista'}"
                onclick="app._marcarVisto('${esc(n.id)}',${!visto})">${visto ? '✅' : '☑️'}</button>`
            + `<button class="modal-btn modal-btn-confirm" onclick="app._responderHilo()">Enviar</button>`;
    },

    _marcarVisto(id, visto) {
        return this._tocarConversacion(id, { visto, nombre: this.usuarioActual?.name || '' },
            visto ? '👁 Dada por vista' : 'Ya no está vista');
    },

    async _responderHilo() {
        const campo = document.getElementById('hiloTexto');
        const texto = (campo.value || '').trim();
        if (!texto) { this._mostrarToast('Escribe algo o adjunta un archivo', 2500); return; }
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id: this._hiloAbierto, texto,
                    ...(false ? { gestor: this._nombreGestor() }
                        : { nombre: this.usuarioActual?.name || '' }) })
            });
            const data = await r.json();
            if (!r.ok) {
                // Si no se ha guardado, que se note y que el texto no se pierda
                this._mostrarToast('❌ No se ha enviado: ' + (data.error || r.status)
                    + '. Tu mensaje sigue escrito, vuelve a darle a Enviar.', 6000);
                return;
            }
            campo.value = '';
                    this._notas = this._notas.map(x => x.id === data.id ? data : x);
            this._marcarLeida(data.id);
            this._renderHilo();
            this._renderNotas();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    async _tocarConversacion(id, cuerpo, mensaje, borrar) {
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: borrar ? 'DELETE' : 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ id, ...cuerpo })
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            this._notas = borrar ? this._notas.filter(x => x.id !== id)
                                 : this._notas.map(x => x.id === id ? data : x);
            if (borrar && this._hiloAbierto === id) {
                document.getElementById('hiloModal').classList.remove('show');
            } else if (this._hiloAbierto === id) {
                this._renderHilo();
            }
            this._renderNotas();
            this._mostrarToast(mensaje, 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    _archivarHilo(id, archivada) {
        return this._tocarConversacion(id, { archivada },
            archivada ? '📥 Archivada' : 'Devuelta a la bandeja');
    },

    _borrarHilo(id) {
        if (!confirm('¿Borrar esta conversación entera? No se puede deshacer.')) return;
        return this._tocarConversacion(id, {}, '🗑️ Conversación borrada', true);
    },

    async enviarNota() {
        const campo = document.getElementById('ntTexto');
        const texto = (campo?.value || '').trim();
        if (!texto) { this._mostrarToast('Escribe algo o adjunta un archivo', 2500); return; }
        const d = this._destino;
        try {
            const r = await fetch(this.NOTAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual?.email || '' },
                // nombre/conductor describen a quien recibe, que es de quien
                // cuelga la nota; quien la manda va aparte en deNombre.
                body: JSON.stringify({ texto,
                    nombre: d ? (d.nombre || d.email) : (this.usuarioActual?.name || ''),
                    conductor: d ? (d.conductor || '') : (this.numConductor || ''),
                    ...(d ? { para: d.email, tipo: 'companero',
                              deNombre: this.usuarioActual?.name || '',
                              deConductor: this.numConductor || '' } : {}) })
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            campo.value = '';
                    this._notas = [data, ...this._notas];
            this._renderNotas();
            this._mostrarToast(d ? `📨 Enviado a ${d.nombre || d.email}` : '📨 Nota enviada a gestión', 3000);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // ── Mi nómina ────────────────────────────────────────────────────────────
    // La rellena el gestor y aquí solo se mira: lo que ha cobrado cada mes,
    // con lo que ha trabajado al lado y la diferencia con el mes anterior.
    // El servidor solo devuelve la de uno mismo; pedir la de otro no lleva a
    // ninguna parte porque el correo sale del token, no de la petición.

    NOMINAS_URL: 'https://registro-horario-emt.vercel.app/api/nominas',
    _misNominas: null,
    _miNomMes: null,

    _mesDeHoy() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    _mesMas(mes, n) {
        const d = new Date(+mes.slice(0, 4), +mes.slice(4, 6) - 1 + n, 1, 12);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    },

    _nombreMes(mes) {
        return `${MESES_ES[+mes.slice(4, 6) - 1]} ${mes.slice(0, 4)}`;
    },

    _eur(n) {
        return (Math.round((Number(n) || 0) * 100) / 100)
            .toFixed(2).replace('.', ',') + ' €';
    },

    miNomMes(paso) {
        this._miNomMes = this._mesMas(this._miNomMes || this._mesDeHoy(), paso);
        this._renderMiNomina();
    },

    async _cargarMisNominas() {
        this._miNomMes = this._miNomMes || this._mesDeHoy();
        if (!this.usuarioActual?.email) return;
        this._renderMiNomina();                 // lo que haya, ya
        try {
            const r = await fetch(
                `${this.NOMINAS_URL}?mio=${encodeURIComponent(this.usuarioActual.email)}`,
                { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            this._misNominas = await r.json() || {};
            localStorage.setItem('misNominas', JSON.stringify(this._misNominas));
        } catch (_) {
            // Sin red vale lo último que se vio: una nómina no cambia sola
            if (!this._misNominas) {
                try { this._misNominas = JSON.parse(localStorage.getItem('misNominas') || 'null'); }
                catch (__) { this._misNominas = null; }
            }
        }
        this._nomEditando = null;
        this._renderMiNomina();
    },

    // ── Rellenarla ───────────────────────────────────────────────────────────
    // Los días y las horas salen de lo que ha registrado; lo demás lo pone él:
    // los precios de su convenio, los porcentajes, los bienios y el sindicato.
    // Un mes nuevo parte del anterior, que casi nunca cambia.

    editarMiNomina() {
        const mes = this._miNomMes;
        const g = this._misNominas?.[mes]
            || this._misNominas?.[this._mesMas(mes, -1)] || {};
        const C = this.CONVENIO;
        this._nomEditando = {
            precios: {
                porDia: { ...C.porDia, ...(g.precios?.porDia || {}) },
                delMes: { ...C.delMes, ...(g.precios?.delMes || {}) },
            },
            // La fecha de alta y, si no hay fecha, el % manual salen del
            // perfil (Opciones › Perfil) — se ponen una vez y valen para
            // todas las nóminas.
            desde:     g.desde || this.fechaAltaDefault || '',
            pctBienios: Number(g.pctBienios ?? this.pctBieniosDefault ?? 0),
            // El sindicato se paga siempre, 12 € por defecto; si se deja de
            // pagar se pone a 0 a mano y ese 0 es lo que sigue arrastrándose.
            sindicato: Number(g.sindicato ?? 12),
            prorrata:  Number(g.prorrata ?? this.PRORRATA_EXTRAS),
            tipos:     { ...this.TIPOS_NOMINA, ...(g.tipos || {}) },
            // Sin nada guardado se quedan a undefined y los pone el cálculo a
            // partir de los registros; en cuanto se escriben, mandan.
            dias:      { asistencia: g.dias?.asistencia },
            extra:     { h: g.extra?.h, p: Number(g.extra?.p ?? this.precioExtraDefault ?? 0) },
            noct:      { h: g.noct?.h,  p: Number(g.noct?.p ?? this.precioNocheDefault ?? 0) },
            extras:    (g.extras || []).map(e => ({ ...e })),
            nota:      g.nota || '',
        };
        this._renderMiNomina();
    },

    cancelarMiNomina() { this._nomEditando = null; this._renderMiNomina(); },

    _setMiNom(campo, valor) {
        const n = Number(String(valor).replace(',', '.')) || 0;
        const partes = campo.split('.');
        let o = this._nomEditando;
        if (partes.length > 1 && !o[partes[0]]) o[partes[0]] = {};
        while (partes.length > 1) o = o[partes.shift()];
        o[partes[0]] = n;
        this._renderMiNomina();
    },

    _setMiExtra(k, campo, valor) {
        if (!this._nomEditando.extras[k]) return;
        this._nomEditando.extras[k][campo] = campo === 'i'
            ? (Number(String(valor).replace(',', '.')) || 0) : valor;
        this._renderMiNomina();
    },

    _nuevoMiExtra() { this._nomEditando.extras.push({ c: '', i: 0 }); this._renderMiNomina(); },
    _quitarMiExtra(k) { this._nomEditando.extras.splice(k, 1); this._renderMiNomina(); },

    async _guardarMiNomina() {
        const cuerpo = { mes: this._miNomMes, email: this.usuarioActual?.email,
            ...this._nomEditando,
            extras: (this._nomEditando.extras || []).filter(e => String(e.c || '').trim()),
            nota: document.getElementById('miNomNota')?.value || '' };
        try {
            const r = await fetch(this.NOMINAS_URL, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cuerpo),
            });
            const data = await r.json();
            if (!r.ok) { this._mostrarToast('❌ ' + (data.error || r.status), 4000); return; }
            this._misNominas = this._misNominas || {};
            this._misNominas[this._miNomMes] = data?.[this._miNomMes] || cuerpo;
            localStorage.setItem('misNominas', JSON.stringify(this._misNominas));
            this._nomEditando = null;
            this._renderMiNomina();
            this._mostrarToast('💶 Nómina guardada', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },

    // El mismo convenio y el mismo cálculo que en gestión: si cada app hiciera
    // sus cuentas, tarde o temprano dirían cosas distintas.
    // El convenio de partida, sacado de una nómina de media jornada. Todo es
    // editable: la completa cobra otra cosa, y el convenio se actualiza.
    CONVENIO: {
        // El de vacaciones va sin la antigüedad: esta se le suma aparte, que
        // también sube el día de vacaciones y la hora extra. En la nómina de
        // junio, 26,83 son estos 25,5551 con el 5 % encima.
        porDia: { base: 772.58 / 30, vacaciones: 375.66 / 14 / 1.05, asistencia: 4.19 },
        delMes: { noAbsorbible: 136.21, transporte: 68.02, ajuste: 130.01,
                  ajuste2: 6.44, responsabilidad: 51.77 },
    },
    // La nómina va a meses de 30 días, no a los del calendario
    DIAS_NOMINA: 30,
    // El complemento de responsabilidad/calidad es nuevo: se empieza a cobrar
    // en la nómina de julio de 2026, y antes de esa no aparece.
    DESDE_RESPONSABILIDAD: '202607',
    PRORRATA_EXTRAS: 135.20,
    TIPOS_NOMINA: { cc: 4.70, desempleo: 1.55, fp: 0.10, mei: 0.15, irpf: 15.00 },

    // Horas extras que registró ese mes
    _horasExtraDelMes(mes) {
        let h = 0;
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id).slice(0, 6) === mes && r.extraManual) h += parseFloat(r.horas) || 0;
        });
        return Math.round(h * 100) / 100;
    },

    // Los días de cada cosa salen de lo que ha registrado: las vacaciones, el
    // permiso retribuido y los días de asistencia. El salario base son los que
    // quedan del mes.
    _diasDeNomina(mes) {
        const vac = new Set(), pr = new Set(), baja = new Set(), trabajados = new Set();
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            const f = this._fechaDeId(id);
            if (f.slice(0, 6) !== mes) return;
            if (r.vacaciones) vac.add(f);
            else if (r.pr)    pr.add(f);
            else if (r.be)    baja.add(f);
            else if ((parseFloat(r.horas) || 0) > 0) trabajados.add(f);
        });
        const vacaciones = Math.min(this.DIAS_NOMINA, vac.size);
        const permiso    = Math.min(this.DIAS_NOMINA - vacaciones, pr.size);
        // El plus de asistencia se cobra por día efectivo: los que ha trabajado
        // y los de permiso retribuido. Los de baja son día efectivo para el
        // salario —por eso no se descuentan del base— pero no llevan plus.
        const asistencia = trabajados.size + permiso;
        return { vacaciones, permiso, asistencia, baja: baja.size,
                 base: Math.max(0, this.DIAS_NOMINA - vacaciones - permiso) };
    },

    // Horas nocturnas registradas ese mes
    _horasNocturnasDelMes(mes) {
        let h = 0;
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id).slice(0, 6) === mes) h += parseFloat(r.horasNocturnas) || 0;
        });
        return Math.round(h * 100) / 100;
    },

    // La antigüedad manda sobre los bienios: con la fecha de entrada puesta,
    // el porcentaje cambia solo el mes que toca y no hay que acordarse.
    // Es un 5 % del salario base del mes entero por tramo: en la nómina de
    // julio, 38,63 son justo el 5 % de 772,58.
    TRAMOS_ANTIGUEDAD: [
        { anios: 24, pct: 60 }, { anios: 20, pct: 50 }, { anios: 16, pct: 40 },
        { anios: 12, pct: 30 }, { anios:  8, pct: 20 }, { anios:  4, pct: 10 },
        { anios:  0, pct:  5 },
    ],

    // Años cumplidos el último día del mes que se está pagando
    _aniosEnLaEmpresa(desde, mes) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || ''))) return null;
        const d = new Date(desde + 'T12:00:00');
        if (isNaN(d)) return null;
        const fin = new Date(+mes.slice(0, 4), +mes.slice(4, 6), 0, 12);
        let a = fin.getFullYear() - d.getFullYear();
        const cumpleYa = (fin.getMonth() > d.getMonth())
            || (fin.getMonth() === d.getMonth() && fin.getDate() >= d.getDate());
        if (!cumpleYa) a--;
        return Math.max(0, a);
    },

    _pctAntiguedad(desde, mes) {
        const a = this._aniosEnLaEmpresa(desde, mes);
        if (a === null) return null;
        return this.TRAMOS_ANTIGUEDAD.find(t => a >= t.anios).pct;
    },

    _calcNomina(mes, n) {
        const D = this.DIAS_NOMINA;
        const g = n || {};
        // Los precios guardados mandan sobre los de partida
        const C = {
            porDia: { ...this.CONVENIO.porDia, ...(g.precios?.porDia || {}) },
            delMes: { ...this.CONVENIO.delMes, ...(g.precios?.delMes || {}) },
        };
        const dias = this._diasDeNomina(mes);
        // Asistencia y horas extras salen de los registros, y se pueden
        // corregir a mano el mes que no cuadren.
        const diasAsist = Number(g.dias?.asistencia ?? dias.asistencia) || 0;
        const hExtra    = Number(g.extra?.h ?? this._horasExtraDelMes(mes)) || 0;
        // El precio de la hora extra y de la nocturna salen de Ajustes › Trabajo,
        // así no hay que volver a escribirlos en cada nómina.
        const pExtra    = Number(g.extra?.p ?? this.precioExtraDefault ?? 0) || 0;
        const hNoct     = Number(g.noct?.h ?? this._horasNocturnasDelMes(mes)) || 0;
        const pNoct     = Number(g.noct?.p ?? this.precioNocheDefault ?? 0) || 0;
        // Con la fecha de entrada puesta manda la antigüedad; si no, lo que
        // se haya escrito a mano. Ambas salen del perfil si la nómina no
        // guarda las suyas propias.
        const desde     = g.desde || this.fechaAltaDefault || '';
        const pctAnt    = this._pctAntiguedad(desde, mes);
        const tipos     = { ...this.TIPOS_NOMINA, ...(g.tipos || {}) };
        const r2 = v => Math.round(v * 100) / 100;

        const porDia = (c, d, p) => ({ c, d, p: r2(p), i: r2(d * p) });
        const delMes = (c, i) => ({ c, d: D, p: r2(i / D), i: r2(i) });

        // El orden es el de la nómina en papel
        const pctBienios = pctAnt !== null ? pctAnt
            : Math.max(0, Math.min(60, Number(g.pctBienios ?? this.pctBieniosDefault ?? 0) || 0));

        const devengos = [porDia('Salario Base', dias.base, C.porDia.base)];
        // La antigüedad sube el día de vacaciones y la hora extra, no solo el
        // salario base.
        const conAnt = v => v * (1 + pctBienios / 100);
        if (dias.vacaciones) devengos.push(porDia('Vacaciones', dias.vacaciones, conAnt(C.porDia.vacaciones)));
        if (dias.permiso)    devengos.push(porDia('Permiso retribuido', dias.permiso, C.porDia.base));
        // Los bienios son un porcentaje del salario base del mes entero, no de
        // los días que haya trabajado: en junio, con catorce de vacaciones,
        // siguen siendo los mismos 38,63 que en julio.
        if (pctBienios) devengos.push({
            ...delMes('Bienios', D * C.porDia.base * pctBienios / 100),
            pctBienios, anios: this._aniosEnLaEmpresa(desde, mes) });
        devengos.push(delMes('Comp. No Absorbible', C.delMes.noAbsorbible));
        devengos.push(delMes('Plus Transporte', C.delMes.transporte));
        devengos.push(delMes('Complemento Ajuste convenio', C.delMes.ajuste));
        devengos.push(delMes('Complemento convenio', C.delMes.ajuste2));
        // Fijo, pero solo desde que existe
        if (mes >= this.DESDE_RESPONSABILIDAD) {
            devengos.push(delMes('Compl. Responsabilidad/Calidad', C.delMes.responsabilidad));
        }
        if (diasAsist) devengos.push(porDia('Complemento Asistencia', diasAsist, C.porDia.asistencia));
        if (hNoct)     devengos.push({ c: 'Complemento horas nocturnas', d: hNoct, p: r2(pNoct),
                                       i: r2(hNoct * pNoct), horas: true });
        if (hExtra)    devengos.push({ c: 'Horas extras', d: hExtra, p: r2(conAnt(pExtra)),
                                       i: r2(hExtra * conAnt(pExtra)), horas: true });
        (g.extras || []).forEach(e => {
            if (e && String(e.c || '').trim()) devengos.push({ c: e.c, d: 0, p: 0, i: r2(Number(e.i) || 0) });
        });

        const devengado = r2(devengos.reduce((t, l) => t + l.i, 0));
        const prorrata  = r2(Number(g.prorrata ?? this.PRORRATA_EXTRAS));
        const base      = r2(devengado + prorrata);
        const sindicato = r2(Number(g.sindicato ?? 12));
        const pct = (c, sobre, p) => ({ c, base: sobre, pct: p, i: r2(sobre * p / 100) });
        const deducciones = [
            pct('Aportac. Contingencias Comunes', base, tipos.cc),
            pct('Desempleo', base, tipos.desempleo),
            pct('Formación Profesional', base, tipos.fp),
            pct('Aportac. Mecanismo de equidad', base, tipos.mei),
            pct('IRPF Cta. Ajena Dinerarios', devengado, tipos.irpf),
        ];
        if (sindicato) deducciones.push({ c: 'Sindicato SITEIB', base: 0, pct: 0, i: sindicato });
        const aDeducir = r2(deducciones.reduce((t, l) => t + l.i, 0));
        return { dias, devengos, deducciones, devengado, prorrata, base, aDeducir,
                 liquido: r2(devengado - aDeducir), precios: C, tipos, sindicato,
                 pctBienios, pctAnt, anios: this._aniosEnLaEmpresa(desde, mes), desde,
                 hExtra, pExtra, hNoct, pNoct, diasAsist };
    },

    _renderMiNomina() {
        const cont = document.getElementById('miNomina');
        if (!cont) return;
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const mes = this._miNomMes = this._miNomMes || this._mesDeHoy();
        const titulo = document.getElementById('miNomMes');
        if (titulo) titulo.textContent = this._nombreMes(mes);

        const editando = this._nomEditando;
        const n = editando || this._misNominas?.[mes];
        if (!n) {
            cont.innerHTML = `<div class="nom-tarjeta"><div class="nom-vacio">
                Todavía no has rellenado la nómina de ${esc(this._nombreMes(mes))}.</div>
                <button class="btn-main" onclick="app.editarMiNomina()">Rellenarla</button></div>`;
            return;
        }
        const c = this._calcNomina(mes, n);
        // Los precios del convenio salen de dividir, así que traen una ristra
        // de decimales que no dice nada: se enseñan con cuatro como mucho.
        const num = v => {
            const x = Number(v);
            if (!isFinite(x)) return String(v);
            return String(Math.round(x * 10000) / 10000).replace('.', ',');
        };
        const linea = (l, resta) => `<div class="nom-l${resta ? ' resta' : ''}">
            <span class="nom-l-c">${esc(l.c)}${l.pctBienios ? ` <small>${l.pctBienios} %${
                l.anios !== null && l.anios !== undefined ? ` · ${l.anios} años` : ''}</small>` : ''
                }${l.d ? ` <small>${num(l.d)}${l.horas ? 'h' : ''} × ${num(l.p)}</small>`
                : l.pct ? ` <small>${num(l.pct)} %</small>` : ''}</span>
            <span class="nom-l-i">${resta ? '−' : ''}${this._eur(l.i)}</span></div>`;

        // Las casillas solo salen al rellenarla; mirando queda la nómina limpia
        const campo = (etiqueta, valor, ruta, sufijo) => !editando ? '' :
            `<div class="nom-edit"><span>${etiqueta}</span>
                <input type="text" inputmode="decimal" value="${num(valor)}"
                       onchange="app._setMiNom('${ruta}', this.value)">${
                sufijo ? `<em>${sufijo}</em>` : ''}</div>`;

        const P = c.precios;
        const ajustes = !editando ? '' : `
            <div class="nom-sec">Tu convenio</div>
            ${campo('Salario base', P.porDia.base, 'precios.porDia.base', '€/día')}
            ${campo('Vacaciones <small>sin antigüedad</small>', P.porDia.vacaciones, 'precios.porDia.vacaciones', '€/día')}
            ${campo('Asistencia', P.porDia.asistencia, 'precios.porDia.asistencia', '€/día')}
            ${campo('Comp. No Absorbible', P.delMes.noAbsorbible, 'precios.delMes.noAbsorbible', '€/mes')}
            ${campo('Plus Transporte', P.delMes.transporte, 'precios.delMes.transporte', '€/mes')}
            ${campo('Ajuste convenio', P.delMes.ajuste, 'precios.delMes.ajuste', '€/mes')}
            ${campo('Complemento convenio', P.delMes.ajuste2, 'precios.delMes.ajuste2', '€/mes')}
            ${campo('Responsabilidad/Calidad', P.delMes.responsabilidad, 'precios.delMes.responsabilidad', '€/mes')}
            ${campo('Prorrata pagas extra', c.prorrata, 'prorrata', '€/mes')}
            <div class="nom-sec">Antigüedad</div>
            ${c.desde
                ? `<div class="nom-nota">Entraste en la empresa el <b>${esc(c.desde)}</b>
                     (Opciones › Perfil).${c.pctAnt !== null
                     ? ` Con ${c.anios} año${c.anios === 1 ? '' : 's'} te toca un
                        <b>${c.pctAnt} %</b> de antigüedad, que sube también el día de
                        vacaciones y la hora extra. Cambia solo cuando cumplas años.` : ''}</div>`
                : `<div class="nom-nota">Sin fecha de alta puesta en Opciones › Perfil, la
                     antigüedad se aplica con el <b>${num(c.pctBienios)} %</b> manual que
                     hayas puesto allí.</div>`}
            <div class="nom-sec">Este mes</div>
            ${campo('Horas extras', c.hExtra, 'extra.h', 'horas')}
            <div class="nom-nota">Hora extra a <b>${num(c.pExtra)} €</b>, el precio que hay
                puesto en Ajustes › Trabajo.</div>
            ${campo('Horas nocturnas', c.hNoct, 'noct.h', 'horas')}
            <div class="nom-nota">Hora nocturna a <b>${num(c.pNoct)} €</b>, el precio que hay
                puesto en Ajustes › Trabajo.</div>
            ${campo('Días de asistencia', c.diasAsist, 'dias.asistencia', 'días')}
            ${(n.extras || []).map((e, k) => `<div class="nom-edit">
                <input type="text" style="flex:1" value="${esc(e.c)}" placeholder="Otro concepto"
                       onchange="app._setMiExtra(${k},'c',this.value)">
                <input type="text" inputmode="decimal" value="${num(e.i ?? 0)}"
                       onchange="app._setMiExtra(${k},'i',this.value)">
                <button class="nom-x" onclick="app._quitarMiExtra(${k})">✕</button></div>`).join('')}
            <button class="nom-mas" onclick="app._nuevoMiExtra()">➕ Añadir concepto</button>
            <div class="nom-sec">Porcentajes</div>
            ${campo('Contingencias comunes', c.tipos.cc, 'tipos.cc', '%')}
            ${campo('Desempleo', c.tipos.desempleo, 'tipos.desempleo', '%')}
            ${campo('Formación profesional', c.tipos.fp, 'tipos.fp', '%')}
            ${campo('Mecanismo de equidad', c.tipos.mei, 'tipos.mei', '%')}
            ${campo('IRPF', c.tipos.irpf, 'tipos.irpf', '%')}
            ${campo('Sindicato', c.sindicato, 'sindicato', '€')}
            <div class="edit-field" style="margin-top:10px;"><label>Nota</label>
                <input type="text" id="miNomNota" value="${esc(n.nota || '')}"
                       placeholder="Lo que quieras recordar"></div>
            <div class="nom-botones">
                <button class="nom-cancel" onclick="app.cancelarMiNomina()">Cancelar</button>
                <button class="btn-main" onclick="app._guardarMiNomina()">Guardar</button>
            </div>`;

        cont.innerHTML = `<div class="nom-tarjeta">
            <div class="nom-sec">Días del mes</div>
            <div class="nom-datos">
                <span class="nom-dato"><b>${c.dias.base}</b> de salario base</span>
                ${c.dias.vacaciones ? `<span class="nom-dato"><b>${c.dias.vacaciones}</b> de vacaciones</span>` : ''}
                ${c.dias.permiso ? `<span class="nom-dato"><b>${c.dias.permiso}</b> de permiso</span>` : ''}
                ${c.diasAsist ? `<span class="nom-dato"><b>${c.diasAsist}</b> de asistencia</span>` : ''}
                ${c.hExtra ? `<span class="nom-dato"><b>${num(c.hExtra)}</b> horas extras</span>` : ''}
            </div>
            <div class="nom-sec">Devengos</div>
            ${c.devengos.map(l => linea(l, false)).join('')}
            <div class="nom-l" style="font-weight:800;"><span class="nom-l-c">Devengado</span>
                <span class="nom-l-i">${this._eur(c.devengado)}</span></div>
            <div class="nom-sec">Deducciones</div>
            ${c.deducciones.map(l => linea(l, true)).join('')}
            <div class="nom-l" style="font-weight:800;"><span class="nom-l-c">A deducir</span>
                <span class="nom-l-i">−${this._eur(c.aDeducir)}</span></div>
            <div class="nom-liquido">
                <span class="nom-liquido-l">Líquido</span>
                <span class="nom-liquido-v">${this._eur(c.liquido)}</span></div>
            <div class="nom-sec">Base de cotización</div>
            <div class="nom-l"><span class="nom-l-c">Devengado + prorrata de pagas extra</span>
                <span class="nom-l-i">${this._eur(c.base)}</span></div>
            ${!editando && n.nota ? `<div class="nom-sec">Nota</div>
                <div class="nom-l"><span class="nom-l-c" style="white-space:normal;">${esc(n.nota)}</span></div>` : ''}
            ${ajustes}
            ${!editando ? `<button class="nom-mas" style="margin-top:12px;"
                onclick="app.editarMiNomina()">✎ Cambiar los datos</button>` : ''}
            ${!editando ? this._compararMiNomina(mes, c) : ''}
        </div>`;
    },

    // Frente al mes anterior, si lo hay
    _compararMiNomina(mes, ahora) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const anterior = this._mesMas(mes, -1);
        const prev = this._misNominas?.[anterior];
        if (!prev) return '';
        const antes = this._calcNomina(anterior, prev);
        const aMapa = c => {
            const m = {};
            c.devengos.forEach(l => { m[l.c] = (m[l.c] || 0) + l.i; });
            c.deducciones.forEach(l => { m[l.c] = (m[l.c] || 0) - l.i; });
            return m;
        };
        const A = aMapa(ahora), B = aMapa(antes);
        const fila = (c, d) => {
            const clase = d > 0 ? 'sube' : d < 0 ? 'baja' : 'igual';
            return `<div class="nom-cmp"><span class="nom-cmp-c">${esc(c)}</span>
                <span class="nom-cmp-v ${clase}">${d > 0 ? '+' : ''}${this._eur(d)}</span></div>`;
        };
        return `<div class="nom-sec">Frente a ${esc(this._nombreMes(anterior))}</div>`
            + fila(`Líquido (antes ${this._eur(antes.liquido)})`,
                   Math.round((ahora.liquido - antes.liquido) * 100) / 100)
            + [...new Set([...Object.keys(A), ...Object.keys(B)])]
                .map(c => fila(c, Math.round(((A[c] ?? 0) - (B[c] ?? 0)) * 100) / 100)).join('');
    },

    // ── Lugar de trabajo de la jornada ───────────────────────────────────────
    // El lugar se elige aquí, y quien pasa por varios sitios en el día —los de
    // calle— puede apuntar cada uno con su horario. La primera entrada y la
    // última salida no hace falta escribirlas: son las de la jornada.

    _tramos: [],

    _lugaresConocidos() {
        const cat = Object.values(LUGARES_CATALOGO || {}).map(l => l?.nombre).filter(Boolean);
        const todos = [...cat];
        [this.puestoTrabajo, this._lugarDeHoy(), ...this._tramos.map(t => t.p)].forEach(p => {
            if (p && !todos.some(x => this._clavePuesto(x) === this._clavePuesto(p))) todos.push(p);
        });
        return todos;
    },

    _opcionesLugar(actual) {
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        return '<option value="">Sin lugar</option>' + this._lugaresConocidos().map(p =>
            `<option${this._clavePuesto(p) === this._clavePuesto(actual) ? ' selected' : ''}>${esc(p)}</option>`).join('');
    },

    // El lugar que viene puesto al ir a registrar: el que te hayan asignado
    // para hoy. En cuanto lo cambias tú —o te sitúa el GPS en otro sitio— manda
    // lo tuyo, pero solo por hoy: mañana vuelve a proponerte lo asignado.
    _lugarPropuesto() {
        if (localStorage.getItem('lugarElegidoEl') === this._hoyClave()) return this.puestoTrabajo;
        return this._lugarDeHoy();
    },

    _renderLugarJornada() {
        const sel = document.getElementById('lugarJornada');
        const propuesto = this._lugarPropuesto();
        if (sel) sel.innerHTML = this._opcionesLugar(propuesto);
        // Lo que se ve es lo que se registra: si se propone el asignado, ese
        // es el que tiene que viajar con la jornada.
        if (this._clavePuesto(propuesto) !== this._clavePuesto(this.puestoTrabajo)) {
            this.puestoTrabajo = propuesto;
            localStorage.setItem('puestoTrabajo', propuesto);
            this._actualizarConductorDisplay();
        }
        this._renderTramos();
    },

    _cambiarLugarJornada(v) {
        this.puestoTrabajo = v || '';
        localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
        this._marcarLugarElegidoHoy();
        this._actualizarCabeceraUsuario();
        this._actualizarConductorDisplay();
        this._renderTramos();
    },

    // Hoy mando yo sobre lo asignado; mañana se vuelve a proponer lo asignado
    _marcarLugarElegidoHoy() {
        localStorage.setItem('lugarElegidoEl', this._hoyClave());
    },

    _nuevoTramo() {
        this._tramos.push({ p: this.puestoTrabajo || '', i: '', o: '' });
        this._renderTramos();
    },

    _setTramo(k, campo, valor) {
        if (!this._tramos[k]) return;
        this._tramos[k][campo] = valor;
        this._renderTramos();
    },

    _quitarTramo(k) { this._tramos.splice(k, 1); this._renderTramos(); },

    // Horas del día ya repartidas en los tramos de abajo. Cada uno empieza,
    // si no se le pone hora, donde acabó el anterior: el de arriba para el
    // primero. La salida siempre se escribe, porque entre un tramo y el
    // siguiente puede haber un hueco sin trabajar y nadie puede adivinarlo.
    _tramosConHoras() {
        const fin = document.getElementById('horaFin')?.value || '';
        let antes = fin;
        return this._tramos.map(t => {
            const con = { ...t, i: t.i || antes, o: t.o || '' };
            if (con.o) antes = con.o;
            return con;
        });
    },

    // Todos los sitios del día, el de arriba incluido.
    //
    // El lugar de trabajo del formulario es el primer sitio de la jornada:
    // desde la hora de entrada hasta que empieza el siguiente. Sin contarlo,
    // de un día repartido solo viajaban los sitios de abajo y la primera
    // parte —la que casi siempre es la más larga— no aparecía en ningún lado:
    // ni en las jornadas anteriores, ni en el cuadro de lugares de gestión.
    _tramosDelDia() {
        const ini = document.getElementById('horaInicio')?.value || '';
        const fin = document.getElementById('horaFin')?.value || '';
        // Con las horas basta. Un tramo sin lugar es un rato trabajado que aún
        // no se sabe dónde va, no un tramo a medias: pidiéndole también el
        // lugar se tiraba sin avisar y esas horas no aparecían en ningún sitio.
        const extras = this._tramosConHoras().filter(t => t.i && t.o && t.i !== t.o);
        if (!extras.length) return [];
        // El de arriba va de su entrada a su salida, ni un minuto más. Antes
        // se estiraba hasta que empezaba el siguiente tramo, así que un día
        // partido —mañana, comer, tarde— cobraba también las horas de en
        // medio: de 9 a 12:30 y de 15:30 a 19 salían 10 horas en vez de 7.
        return [{ p: this.puestoTrabajo || '', i: ini, o: fin }, ...extras]
            .filter(t => t.i && t.o && t.i !== t.o)
            .map(t => ({ p: t.p || '', i: t.i, o: t.o }));
    },

    // Con el día repartido, la jornada va de la primera entrada a la última
    // salida y las horas son las de todos los sitios juntos: antes se quedaba
    // con lo que pusiera arriba y el resto del día no contaba.
    _jornadaDeLosTramos(tramos) {
        if (!tramos.length) return null;
        const horas = tramos.reduce((t, x) => t + this._horasEntre(x.i, x.o), 0);
        return { fin: tramos[tramos.length - 1].o, horas: Math.round(horas * 100) / 100 };
    },

    _horasRepartidas() {
        return this._tramosConHoras().reduce((s, t) =>
            s + (t.i && t.o ? this._horasEntre(t.i, t.o) : 0), 0);
    },

    _renderTramos() {
        const cont = document.getElementById('tramosLista');
        if (!cont) return;
        const conHoras = this._tramosConHoras();
        cont.innerHTML = this._tramos.map((t, k) => `<div class="tramo">
            <select onchange="app._setTramo(${k},'p',this.value)">${this._opcionesLugar(t.p)}</select>
            <input type="time" value="${t.i}" placeholder="entrada"
                onchange="app._setTramo(${k},'i',this.value)" title="En blanco: donde acabó el anterior">
            <input type="time" value="${t.o}"
                onchange="app._setTramo(${k},'o',this.value)" title="La hora a la que se sale de este sitio">
            <button class="tramo-x" onclick="app._quitarTramo(${k})">×</button>
        </div>`).join('');
        const resto = document.getElementById('lugarResto');
        if (!resto) return;
        if (!this._tramos.length) { resto.textContent = ''; resto.classList.remove('falta'); return; }
        // El día entero, con el lugar de arriba incluido: es lo que se va a
        // guardar, así que es lo que hay que enseñar.
        const todos = this._tramosDelDia();
        const total = this._jornadaDeLosTramos(todos);
        const h = n => String(Math.round(n * 100) / 100).replace('.', ',') + 'h';
        const sitios = todos.map(t => `${h(this._horasEntre(t.i, t.o))}${
            t.p ? ' en ' + t.p : ' sin lugar'}`).join(' · ');
        resto.classList.remove('falta');
        resto.textContent = total ? `${sitios} · ${h(total.horas)} en total` : sitios;
        // Y la casilla de horas, al día con lo repartido. La de salida no se
        // toca: es la de este primer sitio, y pisarla con el final del día
        // alargaba el tramo de arriba hasta el último tramo de la tarde.
        if (total) {
            const horasInput = document.getElementById('horasInput');
            // La casilla es numérica: con coma se queda en blanco y luego no
            // deja registrar porque cree que no hay horas.
            if (horasInput) horasInput.value = String(total.horas);
        }
    },

    // ── Cuadros del registro ─────────────────────────────────────────────────
    // Cada uno se puede quitar y se pueden colocar en el orden que se quiera.
    // El orden se aplica con CSS, así que los cuadros siguen en su sitio en el
    // HTML y sus manejadores no cambian.

    CUADROS: [
        { id: 'noche',   el: 'cuadroNoche',       nom: '🌙 Nocturnas' },
        { id: 'pr',      el: 'prCompact',         nom: 'PR · permiso retribuido' },
        { id: 'festivo', el: 'festivoCompact',    nom: '🎉 Festivos' },
        { id: 'extra',   el: 'extraCompact',      nom: '⏱️ Horas extras' },
        { id: 'vac',     el: 'vacacionesCompact', nom: '🏖️ Vacaciones' },
        { id: 'be',      el: 'beCompact',         nom: '🩺 BE · baja' },
    ],

    _configCuadros() {
        let c = null;
        try { c = JSON.parse(localStorage.getItem('cuadrosRegistro') || 'null'); } catch (_) {}
        const todos = this.CUADROS.map(x => x.id);
        // Lo guardado manda, pero un cuadro nuevo no debe quedarse fuera por
        // haber configurado esto antes de que existiera.
        const orden = [...(c?.orden || []).filter(id => todos.includes(id))];
        todos.forEach(id => { if (!orden.includes(id)) orden.push(id); });
        return { orden, ocultos: (c?.ocultos || []).filter(id => todos.includes(id)) };
    },

    _guardarCuadros(c) {
        localStorage.setItem('cuadrosRegistro', JSON.stringify(c));
        this._aplicarCuadros();
        this._renderCuadros();
    },

    _aplicarCuadros() {
        const { orden, ocultos } = this._configCuadros();
        orden.forEach((id, i) => {
            const def = this.CUADROS.find(x => x.id === id);
            const el = document.getElementById(def?.el) || document.querySelector(`[data-cuadro="${id}"]`);
            if (!el) return;
            el.style.order = i;
            el.hidden = ocultos.includes(id);
        });
    },

    mostrarCuadros() {
        this._renderCuadros();
        document.getElementById('cuadrosModal').classList.add('show');
        if (this.darkMode) document.getElementById('cuadrosModalContent').classList.add('dark');
    },

    _renderCuadros() {
        const { orden, ocultos } = this._configCuadros();
        document.getElementById('cuadrosLista').innerHTML = orden.map((id, i) => {
            const def = this.CUADROS.find(x => x.id === id);
            const off = ocultos.includes(id);
            return `<div class="cu-fila${off ? ' off' : ''}">
                <input type="checkbox" ${off ? '' : 'checked'} onchange="app._verCuadro('${id}',this.checked)">
                <span class="cu-nom">${def.nom}</span>
                <button class="cu-mov" onclick="app._moverCuadro('${id}',-1)" ${i === 0 ? 'disabled' : ''}>▲</button>
                <button class="cu-mov" onclick="app._moverCuadro('${id}',1)" ${i === orden.length - 1 ? 'disabled' : ''}>▼</button>
            </div>`;
        }).join('');
    },

    _verCuadro(id, visible) {
        const c = this._configCuadros();
        c.ocultos = visible ? c.ocultos.filter(x => x !== id) : [...new Set([...c.ocultos, id])];
        this._guardarCuadros(c);
    },

    _moverCuadro(id, paso) {
        const c = this._configCuadros();
        const i = c.orden.indexOf(id), j = i + paso;
        if (i < 0 || j < 0 || j >= c.orden.length) return;
        [c.orden[i], c.orden[j]] = [c.orden[j], c.orden[i]];
        this._guardarCuadros(c);
    },

    _cuadrosPorDefecto() {
        localStorage.removeItem('cuadrosRegistro');
        this._aplicarCuadros();
        this._renderCuadros();
    },

    // ── Baja (BE) ────────────────────────────────────────────────────────────
    // Un día de baja se apunta sin horas, y cuenta como jornada hecha contra el
    // objetivo anual: media jornada 3,5h y jornada completa las suyas.
    HORAS_BAJA: 3.5,
    bajaActiva: false,

    _horasBaja() {
        return this._esJornadaCompleta() ? (this.jornadaHoras || 7) : this.HORAS_BAJA;
    },

    clickBe() {
        this.bajaActiva = !this.bajaActiva;
        document.getElementById('beCompact').classList.toggle('active', this.bajaActiva);
        document.getElementById('beToggle').checked = this.bajaActiva;
        if (this.bajaActiva) {
            document.getElementById('horasInput').value = '0';
            this._mostrarToast(`🩺 Día de baja: cuentan ${String(this._horasBaja()).replace('.', ',')}h`, 3000);
        }
    },

    clickVacaciones() {
        this.vacacionesActivo = !this.vacacionesActivo;
        document.getElementById('vacacionesCompact').classList.toggle('active', this.vacacionesActivo);
        document.getElementById('vacacionesToggle').checked = this.vacacionesActivo;
        // A vacation day is logged with no hours
        if (this.vacacionesActivo) document.getElementById('horasInput').value = '0';
    },

    clickExtra() {
        this.extraActivo = !this.extraActivo;
        document.getElementById('extraCompact').classList.toggle('active', this.extraActivo);
        document.getElementById('extraToggle').checked = this.extraActivo;
        document.getElementById('extraPanel').classList.toggle('visible', this.extraActivo);
        const lbl = document.getElementById('extraOptAnual');
        if (lbl) lbl.textContent = this.horasAnualesCustom + 'h';
    },

    _extraDestino() {
        return document.querySelector('input[name="extraDestino"]:checked')?.value || 'anual';
    },

    mostrarCambiarJornada() {
        // Lo que cambia las reglas es si es media jornada o completa, así que se
        // elige entre las dos en vez de escribir un número a ojo.
        this._volverJornada();
        // Media jornada no son solo 3,5h: si tiene otras puestas, la fila lo
        // enseña y queda marcada. Antes con 4h no se marcaba ninguna y al
        // entrar por la de 3,5 se le borraba su valor.
        const media = this._esMedia(this.jornadaHoras);
        const txt = document.getElementById('jmMediaTxt');
        if (txt) txt.textContent = (media ? String(this.jornadaHoras).replace('.', ',') : '3,5') + ' h';
        document.getElementById('jmMedia')?.classList.toggle('sel', media);
        document.getElementById('jmCompleta')?.classList.toggle('sel', !media);
        document.getElementById('jornadaModal').classList.add('show');
        if (this.darkMode) document.getElementById('jornadaModalContent').classList.add('dark');
    },

    elegirJornadaOtra() {
        const v = prompt('¿Cuántas horas tiene tu jornada?\n\nPuedes usar decimales: 3,5 o 3.5', this.jornadaHoras);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.\nEjemplo: 3,5 o 7'); return; }
        this.elegirJornada(n);
    },

    // La media jornada no se hace todos los días, así que al elegirla se
    // pregunta cuáles y cuántas horas en vez de darlo por supuesto.
    _esMedia(n) { return n < this.JORNADA_COMPLETA; },

    // Desde Trabajo se va derecho a los días, sin pasar por elegir jornada
    mostrarDiasJornada() {
        document.getElementById('jornadaModal').classList.add('show');
        if (this.darkMode) document.getElementById('jornadaModalContent').classList.add('dark');
        this._pasoDiasJornada(this.jornadaHoras);
    },

    _volverJornada() {
        document.getElementById('jornadaDias').hidden = true;
        document.getElementById('jornadaPie').hidden = true;
        document.querySelector('#jornadaModal .modal-body').hidden = false;
    },

    _pasoDiasJornada(n) {
        this._jornadaTmp = n;
        this._diasTmp = Array.isArray(this.diasSemana)
            ? this.diasSemana.filter(d => this.DIAS_MEDIA.includes(d))
            : [1, 2, 3, 4, 5];
        document.querySelector('#jornadaModal .modal-body').hidden = true;
        document.getElementById('jornadaDias').hidden = false;
        document.getElementById('jornadaPie').hidden = false;
        document.getElementById('jmHoras').value = String(n).replace('.', ',');
        this._renderSemana();
    },

    // La media jornada se reparte de lunes a domingo
    DIAS_MEDIA: [1, 2, 3, 4, 5, 6, 0],

    _renderSemana() {
        const nombres = ['D','L','M','X','J','V','S'];
        document.getElementById('jmSemana').innerHTML = this.DIAS_MEDIA
            .map(d => `<button class="${this._diasTmp.includes(d) ? 'on' : ''}"
                onclick="app._toggleDiaSemana(${d})">${nombres[d]}</button>`).join('');
        const h = this._leerDecimal(document.getElementById('jmHoras').value) || 0;
        const n = this._diasTmp.length;
        document.getElementById('jmResumen').textContent = n
            ? `${n} día${n === 1 ? '' : 's'} a la semana · ${(n * h).toFixed(1).replace('.', ',')}h semanales`
            : 'Marca al menos un día';
    },

    _toggleDiaSemana(d) {
        const i = this._diasTmp.indexOf(d);
        if (i === -1) this._diasTmp.push(d); else this._diasTmp.splice(i, 1);
        this._renderSemana();
    },

    async _guardarDiasJornada() {
        const h = this._leerDecimal(document.getElementById('jmHoras').value);
        if (h === null || h <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        if (!this._diasTmp.length) { this._mostrarToast('Marca al menos un día', 3000); return; }
        this.diasSemana = this._diasTmp.slice().sort();
        localStorage.setItem('diasSemana', JSON.stringify(this.diasSemana));
        this._sellarDias();
        this._volverJornada();
        await this.elegirJornada(h, true);
    },

    async elegirJornada(n, saltarPaso) {
        // Al entrar por la fila de media jornada se conservan sus horas, que
        // pueden no ser 3,5; solo se usa el valor de la fila si venía de la
        // jornada completa.
        if (this._esMedia(n) && !saltarPaso) {
            return this._pasoDiasJornada(this._esMedia(this.jornadaHoras) ? this.jornadaHoras : n);
        }
        document.getElementById('jornadaModal').classList.remove('show');
        if (n === this.jornadaHoras && saltarPaso !== true) return;
        this.jornadaHoras = n;
        localStorage.setItem('jornadaHoras', String(n));
        // La jornada completa no lleva días fijos: se trabaja lo que toque. Lo
        // manda la jornada anual, no las horas del día: el que hace 7h tres
        // días a la semana va por las 777h y sí tiene días fijos.
        if (this._esJornadaCompleta()) { this.diasSemana = null; localStorage.removeItem('diasSemana'); this._sellarDias(); }
        this._actualizarJornadaDisplay();
        await this._guardarPreferencias(true);
        localStorage.removeItem('resumenHuella');    // que se publique el cambio
        this.cargarDatos();
        this._mostrarToast(`✅ Jornada: ${n}h`, 2500);
    },

    _actualizarJornadaDisplay() {
        const el = document.getElementById('jornadaHorasDisplay');
        if (el) el.textContent = this.jornadaHoras + 'h';
        this._actualizarCampoFestivo();
    },

    // El último dígito es el de control y va tras el guión. El cuerpo puede ser
    // de 3 o de 4 dígitos: 209-1 y 1418-3 son los dos válidos. Devuelve null si
    // no encaja, '' si se ha dejado en blanco.
    _normalizarConductor(v) {
        const digitos = String(v ?? '').replace(/\D/g, '');
        if (!String(v ?? '').trim()) return '';
        if (digitos.length !== 4 && digitos.length !== 5) return null;
        return digitos.slice(0, -1) + '-' + digitos.slice(-1);
    },

    mostrarCambiarConductor() {
        const v = prompt('Número de trabajador.\n\nPuedes escribirlo con o sin guión: 14183 o 1418-3, 2091 o 209-1',
            this.numConductor || '');
        if (v === null) return;
        const val = this._normalizarConductor(v);
        if (val === null) {
            alert('❌ Formato incorrecto. Deben ser 4 o 5 dígitos.\nEjemplo: 209-1 o 1418-3');
            return;
        }
        this.numConductor = val;
        localStorage.setItem('numConductor', val);
        this._actualizarConductorDisplay();
        this._actualizarCabeceraUsuario();
        this._guardarPreferencias();
    },

    _actualizarConductorDisplay() {
        const el = document.getElementById('conductorDisplay');
        if (el) el.textContent = [this.numConductor || 'Sin asignar', this.puestoTrabajo].filter(Boolean).join(' · ');
    },

    // ── Lo que te toca hoy ───────────────────────────────────────────────────
    // Debajo del número de conductor sale a qué hora entras y dónde. El lugar
    // va por fecha: si un día te mandan a otro sitio, ese día sale ese y al
    // siguiente vuelve solo al del mes, sin que nadie tenga que deshacerlo.

    _asignacion: (() => {
        try { return JSON.parse(localStorage.getItem('asignacionHoy') || 'null'); } catch (_) { return null; }
    })(),

    _hoyClave() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    },

    // Vale la de hoy; la de ayer no dice nada de hoy
    _asignacionDeHoy() {
        const a = this._asignacion;
        return (a && a.fecha === this._hoyClave()) ? a : null;
    },

    // Dónde trabajas hoy. Si el servidor ya ha dicho lo de hoy, vale eso y solo
    // eso: ahí dentro ya está resuelto el orden —lo puesto para esa fecha por
    // encima del lugar de siempre—, así que tomar por detrás el valor que haya
    // quedado en el móvil solo serviría para arrastrar el sitio de otro día.
    // Sin respuesta todavía, se tira de lo último que se supo.
    _lugarDeHoy() {
        const a = this._asignacionDeHoy();
        return a ? (a.lugar || '') : (this.puestoTrabajo || '');
    },

    async _cargarAsignacion() {
        const email = this.usuarioActual?.email;
        if (!email) return;
        try {
            const r = await fetch(`${this.USUARIOS_URL}?mio=${encodeURIComponent(email)}`,
                { cache: 'no-store' });
            if (!r.ok) return;
            const a = await r.json();
            if (!a || !a.fecha) return;
            this._asignacion = a;
            localStorage.setItem('asignacionHoy', JSON.stringify(a));
            this._actualizarCabeceraUsuario();
            // Si lo que propone el formulario ha cambiado, se repinta; si no,
            // se deja en paz por si está a medio rellenar.
            const sel = document.getElementById('lugarJornada');
            if (sel && this._clavePuesto(sel.value) !== this._clavePuesto(this._lugarPropuesto())) {
                this._renderLugarJornada();
            }
        } catch (_) { /* sin red se queda lo último que se supo */ }
    },

    _actualizarCabeceraUsuario() {
        const nom = document.getElementById('cabeceraNombre');
        if (nom) nom.textContent = this.usuarioActual?.name || '';
        const num = document.getElementById('cabeceraNum');
        if (num) num.textContent = this.numConductor || '';

        const a = this._asignacionDeHoy();
        const lugar = this._lugarDeHoy();
        const hor = document.getElementById('cabeceraHorario');
        const lug = document.getElementById('cabeceraLugar');
        // De baja, de vacaciones o libre no hay horario que enseñar
        const mudo = a && (a.baja || a.vacaciones || a.libre);
        const horas = !mudo && a?.horario?.i && a?.horario?.f
            ? `${a.horario.i}–${a.horario.f}` : '';
        if (hor) hor.textContent = horas ? `🕒 ${horas}` : '';
        if (lug) {
            lug.textContent = lugar ? (horas ? ` · ${lugar}` : lugar) : '';
            lug.classList.toggle('fuera', !!a?.excepcion);
            lug.title = a?.excepcion ? 'Hoy te toca en otro sitio' : '';
        }
        this._pintarCompaneros();
    },

    // ── Con quién trabajas ───────────────────────────────────────────────────
    // El lugar de la cabecera se pone verde cuando hay alguien más ahí hoy, y
    // al tocarlo se ve quién es.

    COMPANEROS_TTL: 10 * 60 * 1000,

    _claveCompaneros() {
        return `${this._clavePuesto(this._lugarDeHoy())}|${new Date().toISOString().slice(0, 10)}`;
    },

    _companerosEnCache() {
        try {
            const c = JSON.parse(localStorage.getItem('companeros') || 'null');
            if (c && c.clave === this._claveCompaneros() && Date.now() - c.at < this.COMPANEROS_TTL) return c;
        } catch (_) {}
        return null;
    },

    async _cargarCompaneros(forzar) {
        if (!this._lugarDeHoy()) return null;
        const cache = this._companerosEnCache();
        if (cache && !forzar) return cache;
        const resp = await fetch(`${this.USUARIOS_URL}?lugar=${encodeURIComponent(this._lugarDeHoy())}`,
            { cache: 'no-store' });
        if (!resp.ok) throw new Error(resp.status);
        const data = await resp.json();
        const c = { clave: this._claveCompaneros(), at: Date.now(), gente: data.gente || [] };
        localStorage.setItem('companeros', JSON.stringify(c));
        return c;
    },

    // Verde solo si hay alguien más: si va solo, la cabecera no cambia
    _pintarCompaneros() {
        const lug = document.getElementById('cabeceraLugar');
        if (!lug) return;
        const c = this._companerosEnCache();
        // El naranja de "hoy vas a otro sitio" manda sobre el verde
        lug.classList.toggle('juntos', !!c && c.gente.length > 1
            && !lug.classList.contains('fuera'));
        if (!c && this._lugarDeHoy()) {
            this._cargarCompaneros().then(() => this._pintarCompaneros()).catch(() => {});
        }
    },

    async verCompaneros() {
        const donde = this._lugarDeHoy();
        if (!donde) {
            this._mostrarToast('Todavía no tienes lugar de trabajo', 3000);
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, x => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[x]));
        document.getElementById('compTitulo').textContent = `👥 Hoy en ${donde}`;
        document.getElementById('compLista').innerHTML = '<div class="comp-vacio">Cargando…</div>';
        document.getElementById('compModal').classList.add('show');
        if (this.darkMode) document.getElementById('compModalContent').classList.add('dark');
        let c;
        try { c = await this._cargarCompaneros(true); }
        catch (_) {
            document.getElementById('compLista').innerHTML =
                '<div class="comp-vacio">No se ha podido consultar. Inténtalo luego.</div>';
            return;
        }
        this._pintarCompaneros();
        const gente = c.gente || [];
        document.getElementById('compLista').innerHTML = gente.length
            ? gente.map(g => {
                const yo = g.email && this.usuarioActual?.email
                    && g.email.toLowerCase() === this.usuarioActual.email.toLowerCase();
                const h = g.horario;
                return `<div class="comp-fila${yo ? ' yo' : ''}">
                    <span class="comp-num">${esc(g.conductor) || '—'}</span>
                    <span class="comp-nom">${esc(g.nombre) || 'Sin nombre'}${yo ? ' (tú)' : ''}</span>
                    ${h ? `<span class="comp-hora${h.real ? '' : ' plan'}">${esc(h.i)}${
                        h.f ? '–' + esc(h.f) : ''}</span>` : ''}
                </div>`;
            }).join('')
              + (gente.length > 1
                    ? ''
                    : '<div class="comp-vacio">Hoy no hay nadie más aquí.</div>')
            : '<div class="comp-vacio">Hoy no hay nadie asignado aquí.</div>';
    },

    // Record ids are YYYYMMDD for the first entry of a day, then YYYYMMDD-2, -3…
    _nuevoRegistroId(historial, fechaKey) {
        if (!historial[fechaKey]) return fechaKey;
        let n = 2;
        while (historial[`${fechaKey}-${n}`]) n++;
        return `${fechaKey}-${n}`;
    },

    _fechaDeId(id) { return String(id).slice(0, 8); },

    // Horas que cuentan para las anuales. Un festivo trabajado cuenta sus horas
    // como cualquier otro día; uno sin trabajar cuenta como jornada entera.
    //
    // De ahí sale, sin hacer nada especial, lo que marca la ley para la media
    // jornada: trabaja de lunes a viernes, y un festivo en miércoles le deja la
    // semana en 14h trabajadas + 3,5h del festivo = 17,5h, mientras que uno en
    // sábado le suma 3,5h encima de la semana entera = 21h.
    _horasEfectivas(fecha, reg) {
        const h = parseFloat(reg.horas) || 0;
        // Un día de baja sin horas cuenta como jornada hecha contra el objetivo
        if (reg.be && h === 0) return this._horasBaja();
        if (reg.festivo && h === 0) return this.jornadaHoras;
        return h;
    },

    _hayRegistroEnFecha(fechaKey) {
        return Object.keys(this._historialFull || {}).some(id => this._fechaDeId(id) === fechaKey);
    },

    // Single source of truth for all hour totals, derived from the history
    _calcTotales(historial) {
        let anual = 0, extrasManual = 0, festivo = 0, diasFestivos = 0, diasExtra = 0;
        const completa = this._esJornadaCompleta();
        Object.entries(historial || {}).forEach(([id, r]) => {
            const h = parseFloat(r.horas) || 0;
            // Venir a trabajar un festivo o un libre se cobra como día extra
            // El día extra solo lo cobra la jornada completa: la media jornada
            // no trabaja festivos ni libres, se le descuentan y ya está.
            if (h > 0 && completa && (r.festivo || r.extraDestino === 'extras')) diasExtra++;
            if (r.extraDestino === 'extras') { extrasManual += h; return; }
            const efectivas = this._horasEfectivas(this._fechaDeId(id), r);
            if (r.festivo) { festivo += efectivas; diasFestivos++; }
            anual += efectivas;
        });
        const tope    = this.horasAnualesCustom;
        const topeExt = Math.round(tope * 0.30 * 10) / 10;
        const exceso  = Math.max(0, anual - tope);
        const r1 = n => Math.round(n * 10) / 10;
        return {
            anual:     r1(Math.min(anual, tope)),
            anualReal: r1(anual),
            extras:    r1(extrasManual + exceso),
            topeExtras: topeExt,
            festivo:   r1(festivo),
            diasFestivos,
            diasExtra,
            importeDiasExtra: r1(diasExtra * this.precioFestivoDefault),
            restantes: r1(Math.max(0, tope - anual))
        };
    },

    // Easter Sunday (Meeus/Jones/Butcher algorithm)
    _domingoPascua(year) {
        const a = year % 19, b = Math.floor(year / 100), c = year % 100;
        const d = Math.floor(b / 4), e = b % 4;
        const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4), k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mes = Math.floor((h + l - 7 * m + 114) / 31);
        const dia = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, mes - 1, dia);
    },

    // Holidays for Palma de Mallorca: national + Balearic + local
    _festivosPalma(year) {
        const f = {};
        const key = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const add = (mmdd, nombre) => { f[mmdd] = nombre; };
        // Nacionales
        add('01-01', 'Año Nuevo');
        add('01-06', 'Reyes');
        add('05-01', 'Fiesta del Trabajo');
        add('08-15', 'Asunción');
        add('10-12', 'Fiesta Nacional');
        add('11-01', 'Todos los Santos');
        add('12-06', 'Constitución');
        add('12-08', 'Inmaculada');
        add('12-25', 'Navidad');
        // Baleares
        add('03-01', 'Dia de les Illes Balears');
        add('12-26', 'Sant Esteve');
        // Palma
        add('01-20', 'Sant Sebastià');
        // Móviles (Semana Santa)
        const pascua = this._domingoPascua(year);
        const vSanto = new Date(pascua); vSanto.setDate(pascua.getDate() - 2);
        const lPascua = new Date(pascua); lPascua.setDate(pascua.getDate() + 1);
        add(key(vSanto),  'Viernes Santo');
        add(key(lPascua), 'Lunes de Pascua');
        return f;
    },

    _nombreFestivo(fechaStr) {
        if (!fechaStr) return null;
        const [y, m, d] = fechaStr.split('-');
        return this._festivosPalma(parseInt(y, 10))[`${m}-${d}`] || null;
    },

    comprobarFestivo() {
        const fecha = document.getElementById('fechaInput').value;
        const hint  = document.getElementById('festivoHint');
        const nombre = this._nombreFestivo(fecha);
        if (hint) {
            hint.textContent = nombre ? `· 🎉 ${nombre}` : '';
            hint.style.display = nombre ? 'inline' : 'none';
        }
        if (nombre && !this.festivoActivo) this.clickFestivo();
    },


    // Swipe horizontal para cambiar de pestaña. Se ignora si el gesto empieza
    // sobre algo desplazable en horizontal (p. ej. el cuadrante ampliado).
    // Un dedo que empieza sobre algo que se desplaza de lado —las filas de
    // filtros, el cuadrante ampliado— es para mover eso, no para cambiar de
    // pestaña ni de día. Antes se tragaba el gesto y los filtros medio ocultos
    // no había manera de sacarlos.
    _sobreCarrusel(destino, hasta) {
        for (let el = destino; el && el !== hasta && el.nodeType === 1; el = el.parentElement) {
            if (el.scrollWidth - el.clientWidth < 12) continue;
            const desborde = getComputedStyle(el).overflowX;
            if (desborde === 'auto' || desborde === 'scroll') return true;
        }
        return false;
    },


    switchTab(idx) {
        this._activeTab = idx;
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.tab, 10) === idx);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'tabPanel' + idx);
        });
        localStorage.setItem('activeTab', String(idx));
        if (idx === 1) this._cargarCuadrante();
        if (idx === 2) { this._pintarDestino(); this._cargarNotas(); }
        if (idx === 3) this._cargarMisNominas();
    },

    _tabDragStart(e) {
        this._dragSrcTab = e.currentTarget;
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.tab);
    },

    _tabDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('drag-over'));
        this._guardarOrdenTabs();
    },

    _guardarOrdenTabs() {
        const orden = [...document.querySelectorAll('#tabBar .tab-btn')].map(b => b.dataset.tab);
        localStorage.setItem('tabOrder', JSON.stringify(orden));
    },

    _restaurarTabs() {
        const bar = document.getElementById('tabBar');
        if (!bar) return;
        try {
            const orden = JSON.parse(localStorage.getItem('tabOrder') || 'null');
            if (Array.isArray(orden)) {
                orden.forEach(t => {
                    const btn = bar.querySelector(`.tab-btn[data-tab="${t}"]`);
                    if (btn) bar.appendChild(btn);
                });
            }
        } catch(_) {}
        const activa = parseInt(localStorage.getItem('activeTab') || '0', 10);
        this.switchTab(Number.isInteger(activa) ? activa : 0);
    },

    _tabDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over');
    },

    _tabDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    },

    _tabDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        const src = this._dragSrcTab;
        const dst = e.currentTarget;
        if (!src || src === dst) return;
        const bar = document.getElementById('tabBar');
        const tabs = [...bar.children];
        const si = tabs.indexOf(src);
        const di = tabs.indexOf(dst);
        if (si < di) bar.insertBefore(src, dst.nextSibling);
        else bar.insertBefore(src, dst);
        this._guardarOrdenTabs();
    },

    toggleNoche() {
        const on = document.getElementById('nocheToggle').checked;
        document.getElementById('nocheExtra').classList.toggle('visible', on);
        if (on && this.precioNocheDefault > 0 && !document.getElementById('precioNoche').value)
            document.getElementById('precioNoche').value = this.precioNocheDefault;
        if (!on) { document.getElementById('nocheResumen').textContent = ''; document.getElementById('horasNocturnas').value = ''; }
    },

    calcularExtra() {
        const hN = parseFloat(document.getElementById('horasNocturnas').value) || 0;
        const precio = parseFloat(document.getElementById('precioNoche').value) || 0;
        document.getElementById('nocheResumen').textContent =
            (hN > 0 && precio > 0) ? `Extra: ${hN}h × ${precio}€ = ${(hN * precio).toFixed(2)}€` : '';
    },

    calcularExtraModal() {
        const hN = parseFloat(document.getElementById('editModalNocturnas').value) || 0;
        const precio = parseFloat(document.getElementById('editModalPrecioN').value) || 0;
        document.getElementById('editModalExtraLabel').textContent =
            (hN > 0 && precio > 0) ? `+${(hN * precio).toFixed(2)}€ extra nocturno` : '';
    },

    calcularHorasModalPorTiempo() {
        const inicio = document.getElementById('editModalInicio').value;
        const fin    = document.getElementById('editModalFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('editModalHoras').value = horas;
        const nocturnas = this._calcHorasNocturnas(inicio, fin);
        document.getElementById('editModalNocturnas').value = nocturnas || '';
        if (nocturnas > 0 && this.precioNocheDefault > 0 && !document.getElementById('editModalPrecioN').value)
            document.getElementById('editModalPrecioN').value = this.precioNocheDefault;
        this.calcularExtraModal();
    },

    guardarUltimaHoraInicio() { const val = document.getElementById('horaInicio').value; if (val) { localStorage.setItem('lastHoraInicio', val); this._guardarPreferencias(); } },
    guardarUltimaHoraFin()    { const val = document.getElementById('horaFin').value;    if (val) { localStorage.setItem('lastHoraFin', val);    this._guardarPreferencias(); } },

    guardarSonidoNotif(sound) {
        this.notifSound = sound;
        localStorage.setItem('notifSound', sound);
        window.AndroidBridge?.saveToPrefs('notifSound', sound);
        this._guardarPreferencias();
        this._previewNotifSound(sound);
    },

    _previewNotifSound(sound) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const bell = (freq, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.value = freq;
                g.gain.setValueAtTime(0.55, t0);
                g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur + 0.05);
            };
            const tone = (freq, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.value = freq;
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.5, t0 + 0.012);
                g.gain.linearRampToValueAtTime(0.5, t0 + dur - 0.07);
                g.gain.linearRampToValueAtTime(0, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur);
            };
            const sweep = (f1, f2, t0, dur) => {
                const osc = ctx.createOscillator(); const g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.frequency.setValueAtTime(f1, t0);
                osc.frequency.linearRampToValueAtTime(f2, t0 + dur);
                g.gain.setValueAtTime(0, t0);
                g.gain.linearRampToValueAtTime(0.45, t0 + 0.02);
                g.gain.linearRampToValueAtTime(0.45, t0 + dur - 0.08);
                g.gain.linearRampToValueAtTime(0, t0 + dur);
                osc.start(t0); osc.stop(t0 + dur);
            };
            const t = ctx.currentTime + 0.05;
            switch (sound) {
                case 'notif_ding':    bell(880, t, 1.0); break;
                case 'notif_campana': bell(660, t, 0.5); bell(880, t + 0.42, 0.75); break;
                case 'notif_alerta':  tone(440, t, 0.20); tone(660, t+0.25, 0.20); tone(880, t+0.50, 0.30); break;
                case 'notif_silbido': sweep(800, 1400, t, 0.42); sweep(1400, 800, t+0.40, 0.38); break;
                case 'notif_doble':   tone(880, t, 0.30); tone(880, t+0.42, 0.30); break;
                case 'notif_fanfare': tone(440, t, 0.20); tone(550, t+0.22, 0.20); tone(660, t+0.44, 0.20); bell(880, t+0.66, 0.60); break;
                case 'notif_suave':   bell(330, t, 1.2); break;
                default:              bell(880, t, 0.7);
            }
        } catch(_) {}
    },

    limpiarInput() {
        // Limpiar desmarca todo menos el festivo, y recupera el horario del día
        // anterior. No debe reabrir el cajón nocturno aunque ese horario lo sea.
        const manteniaFestivo = this.festivoActivo;
        this.establecerFechaHoy();
        const lastInicio = localStorage.getItem('lastHoraInicio') || '';
        const lastFin    = localStorage.getItem('lastHoraFin') || '';
        document.getElementById('horaInicio').value = lastInicio;
        document.getElementById('horaFin').value    = lastFin;
        document.getElementById('nocheExtra').classList.remove('visible');
        document.getElementById('horasNocturnas').value = '';
        document.getElementById('precioNoche').value    = '';
        document.getElementById('nocheResumen').textContent = '';
        document.getElementById('nocheToggle').checked = false;
        document.querySelector('.noche-compact')?.classList.remove('active');
        this.prActivo = false;
        document.getElementById('prCompact').classList.remove('active');
        document.getElementById('prToggle').checked = false;
        this.vacacionesActivo = false;
        document.getElementById('vacacionesCompact')?.classList.remove('active');
        const vt = document.getElementById('vacacionesToggle'); if (vt) vt.checked = false;
        this.extraActivo = false;
        document.getElementById('extraCompact')?.classList.remove('active');
        const et = document.getElementById('extraToggle'); if (et) et.checked = false;
        document.getElementById('extraPanel')?.classList.remove('visible');
        this.bajaActiva = false;
        document.getElementById('beCompact')?.classList.remove('active');
        const bt = document.getElementById('beToggle'); if (bt) bt.checked = false;
        this._tramos = [];
        this._renderLugarJornada();
        // Horas del horario recuperado, sin activar nada nocturno
        document.getElementById('horasInput').value = (lastInicio && lastFin)
            ? this._horasEntre(lastInicio, lastFin) : '';
        this.festivoActivo = false;
        document.getElementById('festivoCompact').classList.remove('active');
        document.getElementById('festivoToggle').checked = false;
        this.comprobarFestivo();                 // vuelve a marcarlo si la fecha es festiva
        if (manteniaFestivo && !this.festivoActivo) this.clickFestivo();
    },

    _horasEntre(inicio, fin) {
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        return Math.round(mins / 60 * 2) / 2;
    },

    cancelarEdicion() { this.editingId = null; this.limpiarInput(); },

    mostrarHistorialModal() {
        document.getElementById('historialModal').classList.add('show');
        if (this.darkMode) document.getElementById('historialModalContent').classList.add('dark');
        this._renderHistorialModal();
    },

    _mesesColapsados: new Set(JSON.parse(localStorage.getItem('mesesColapsados') || '[]')),

    _toggleMes(mesKey) {
        if (this._mesesColapsados.has(mesKey)) this._mesesColapsados.delete(mesKey);
        else this._mesesColapsados.add(mesKey);
        localStorage.setItem('mesesColapsados', JSON.stringify([...this._mesesColapsados]));
        this._renderHistorialModal();
    },

    _renderHistorialModal() {
        const list = document.getElementById('historialModalList');
        list.innerHTML = '';
        const registros = Object.entries(this._historialMap).sort((a, b) => b[1].timestamp - a[1].timestamp);
        if (registros.length === 0) {
            list.innerHTML = '<li style="text-align:center;padding:24px;color:#95a5a6;font-size:13px;">Sin registros</li>';
            return;
        }
        let mesActual = null;
        registros.forEach(([id, reg]) => {
            // Month separator
            const d = new Date(reg.timestamp);
            const mesKey = `${d.getFullYear()}-${d.getMonth()}`;
            if (mesKey !== mesActual) {
                mesActual = mesKey;
                const delMes = registros
                    .filter(([, r]) => { const x = new Date(r.timestamp); return `${x.getFullYear()}-${x.getMonth()}` === mesKey; });
                const totMes = delMes.reduce((s, [, r]) => s + (parseFloat(r.horas) || 0), 0);
                const nocMes = delMes.reduce((s, [, r]) => s + (parseFloat(r.horasNocturnas) || 0), 0);
                const mesesCalc = this._calcTodosMeses(this._historialMap);
                const extMes = mesesCalc[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`]?.horasExtras || 0;
                const cab = document.createElement('li');
                cab.className = 'hm-mes';
                cab.dataset.mes = mesKey;
                const colapsado = this._mesesColapsados.has(mesKey);
                const r1 = n => (Math.round(n * 10) / 10).toFixed(1);
                cab.innerHTML = `<span class="hm-mes-chev">${colapsado ? '▸' : '▾'}</span>`
                    + `<span class="hm-mes-n">${MESES_ES[d.getMonth()]} ${d.getFullYear()}</span>`
                    + `<span class="hm-mes-tot">`
                    + (extMes > 0 ? `<span class="hm-mes-ext">⏱️${r1(extMes)}h</span>` : '')
                    + (nocMes > 0 ? `<span class="hm-mes-noc">🌙${r1(nocMes)}h</span>` : '')
                    + `${r1(totMes)}h`
                    + `<span class="hm-mes-c">${delMes.length}</span></span>`;
                cab.addEventListener('click', () => this._toggleMes(mesKey));
                list.appendChild(cab);
            }
            if (this._mesesColapsados.has(mesKey)) return;
            const li = document.createElement('li');
            // Colored left stripe: festivo > extra > nocturno > PR
            let stripeClass = '';
            if (reg.vacaciones) stripeClass = 'hm-stripe-vacaciones';
            else if (reg.festivo) stripeClass = 'hm-stripe-festivo';
            else if (reg.extraManual) stripeClass = 'hm-stripe-extra';
            else if (reg.horasNocturnas) stripeClass = 'hm-stripe-noche';
            else if (reg.pr) stripeClass = 'hm-stripe-pr';
            li.className = stripeClass;
            li.style.cssText = 'padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #efefef;gap:8px;';
            const nocheStr = reg.horasNocturnas
                ? `<div style="font-size:10px;color:#856404;font-weight:600;">🌙 ${reg.horasNocturnas}h noct. · +${(reg.extraNoche||0).toFixed(2)}€</div>` : '';
            const horario = (reg.horaInicio && reg.horaFin)
                ? `<span style="color:#95a5a6;font-size:10px;font-style:italic;">${reg.horaInicio}–${reg.horaFin}</span>` : '';
            // Las jornadas viejas no lo llevan guardado: se usa el lugar actual
            const lugar = reg.puesto || this.puestoTrabajo;
            const lugarStr = lugar
                ? `<span style="color:var(--g1);font-size:10px;font-weight:700;">${lugar}</span>` : '';
            // Un día repartido entre varios sitios enseñaba solo el primero, y
            // el resto de la jornada no aparecía por ningún lado.
            const tramos = Array.isArray(reg.tramos) ? reg.tramos.filter(t => t && t.i && t.o) : [];
            const tramosStr = tramos.length > 1
                ? `<div class="hm-tramos">${tramos.map(t =>
                    `<span>📍 ${t.p ? String(t.p).replace(/</g, '&lt;') : 'sin lugar'} ${t.i}–${t.o}</span>`).join('')}</div>` : '';
            const prBadge     = reg.pr      ? `<span class="pr-badge">PR</span>` : '';
            const festivoBadge= reg.festivo ? `<span class="festivo-badge">🎉 Festivo</span>` : '';
            const vacBadge    = reg.vacaciones ? `<span class="vacaciones-badge">🏖️ Vacaciones</span>` : '';
            const beBadge     = reg.be ? `<span class="be-badge">🩺 BE ${
                String(this._horasBaja()).replace('.', ',')}h</span>` : '';
            const extraBadge  = reg.extraManual
                ? `<span class="extra-badge">⏱️ ${reg.extraDestino === 'extras' ? 'Extra' : 'Anual'}</span>` : '';
            li.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="color:#7f8c8d;font-weight:700;font-size:12px;">${reg.fecha}</span>
                        ${horario}
                        <span style="background:linear-gradient(135deg,var(--g1),var(--g2));color:white;padding:3px 9px;border-radius:20px;font-weight:700;font-size:10px;">${reg.horas}h</span>
                        ${lugarStr}
                        ${prBadge}${festivoBadge}${extraBadge}${vacBadge}${beBadge}
                    </div>
                    ${tramosStr}
                    ${nocheStr}
                    ${reg.nota ? `<div class="hm-nota-txt">📝 ${reg.nota.replace(/</g,'&lt;')}</div>` : ''}
                </div>
                <div style="display:flex;gap:5px;flex-shrink:0;">
                    <button class="hm-nota" style="background:${reg.nota ? '#f39c12' : '#95a5a6'};color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">📝</button>
                    <button class="hm-edit" style="background:#3498db;color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">✏️</button>
                    <button class="hm-del"  style="background:#e74c3c;color:white;padding:5px 9px;border-radius:6px;font-size:12px;cursor:pointer;border:none;font-weight:600;">×</button>
                </div>`;
            li.querySelector('.hm-nota').addEventListener('click', () => this.editarNota(id));
            li.querySelector('.hm-edit').addEventListener('click', () => {
                document.getElementById('historialModal').classList.remove('show');
                this.editarRegistro(id);
            });
            li.querySelector('.hm-del').addEventListener('click', () => this.borrarRegistro(id));
            list.appendChild(li);
        });
    },

    async editarNota(id) {
        const reg = this._historialMap[id];
        if (!reg) return;
        const v = prompt(`Nota para la jornada del ${reg.fecha}:\n\n(déjala vacía para borrarla)`, reg.nota || '');
        if (v === null) return;
        const nota = v.trim().slice(0, 300);
        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            if (!datos.historial?.[id]) { this._mostrarToast('❌ No se encontró la jornada', 3000); return; }
            if (nota) datos.historial[id].nota = nota;
            else delete datos.historial[id].nota;
            await this._writeDriveFile(datos);
            this.actualizarUI(datos);
            this._renderHistorialModal();
            this._mostrarToast(nota ? '✅ Nota guardada' : 'Nota borrada', 2500);
        } catch (e) {
            this._mostrarToast('❌ Error al guardar la nota', 3000);
        }
    },

    // Cerrar el cuadro sin guardar deja de contar como editar
    cerrarEdicion() {
        this.editingId = null;
        document.getElementById('editModal').classList.remove('show');
    },

    editarRegistro(id) {
        const reg = this._historialMap[id];
        if (!reg) return;
        this.editingId = id;
        const f = this._fechaDeId(id);
        const fecha = `${f.slice(0,4)}-${f.slice(4,6)}-${f.slice(6,8)}`;
        document.getElementById('editModalFecha').value    = fecha;
        document.getElementById('editModalHoras').value    = reg.horas;
        document.getElementById('editModalInicio').value   = reg.horaInicio || '';
        document.getElementById('editModalFin').value      = reg.horaFin    || '';
        document.getElementById('editModalNocturnas').value= reg.horasNocturnas || '';
        document.getElementById('editModalPrecioN').value  = reg.precioNoche    || '';
        document.getElementById('editModalExtraLabel').textContent =
            reg.horasNocturnas ? `+${(reg.extraNoche || 0).toFixed(2)}€ extra nocturno` : '';
        document.getElementById('editModalPR').checked = !!reg.pr;
        document.getElementById('editModalFestivo').checked = !!reg.festivo;
        document.getElementById('editModal').classList.add('show');
        if (this.darkMode) document.getElementById('editModalContent').classList.add('dark');
    },

    _calcMesStats(historial, año, mes) {
        const entries = Object.values(historial).filter(r => {
            const d = new Date(r.timestamp);
            return d.getFullYear() === año && d.getMonth() + 1 === mes;
        });
        return {
            horas:     Math.round(entries.reduce((s, r) => s + r.horas, 0) * 10) / 10,
            nocturnas: Math.round(entries.reduce((s, r) => s + (r.horasNocturnas || 0), 0) * 10) / 10,
            extra:     Math.round(entries.reduce((s, r) => s + (r.extraNoche || 0), 0) * 100) / 100,
            dias:      entries.length
        };
    },

    _calcTodosMeses(historial) {
        const meses = {};
        // Chronological pass: hours past the annual cap are overtime, and this is
        // the only way to attribute them to the month they actually happened in.
        const orden = Object.entries(historial || {})
            .filter(([, r]) => r.timestamp)
            .sort((a, b) => a[1].timestamp - b[1].timestamp)
            .map(([id, r]) => ({ ...r, _fecha: this._fechaDeId(id) }));
        const tope = this.horasAnualesCustom;
        let acumulado = 0;
        orden.forEach(reg => {
            const d   = new Date(reg.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!meses[key]) meses[key] = { horas:0, nocturnas:0, extra:0, horasExtras:0, dias:0, label:'', año:d.getFullYear(), mes:d.getMonth()+1 };
            const h = parseFloat(reg.horas) || 0;
            let extrasReg;
            if (reg.extraDestino === 'extras') {
                extrasReg = h;                       // marked as overtime by hand
            } else {
                const efectivas = this._horasEfectivas(reg._fecha, reg);
                const cabe = Math.max(0, tope - acumulado);
                extrasReg = Math.max(0, efectivas - cabe);
                acumulado += efectivas;
            }
            meses[key].horas       = Math.round((meses[key].horas     + h) * 10) / 10;
            meses[key].nocturnas   = Math.round((meses[key].nocturnas + (reg.horasNocturnas||0)) * 10) / 10;
            meses[key].extra       = Math.round((meses[key].extra     + (reg.extraNoche||0)) * 100) / 100;
            meses[key].horasExtras = Math.round((meses[key].horasExtras + extrasReg) * 10) / 10;
            meses[key].dias++;
            meses[key].label = `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
        });
        return meses;
    },

    actualizarUI(datos) {
        this._historialFull = datos.historial || {};
        // El aviso nativo corre con la app cerrada y no puede mirar aquí, así
        // que se le deja escrito en qué lugares ya se ha registrado hoy.
        this._publicarLugaresHoy();
        const t         = this._calcTotales(this._historialFull);
        const horas     = t.anual;
        const restantes = t.restantes;
        const pct       = (t.anualReal / this.horasAnualesCustom) * 100;
        // Ocultar el banner de proximidad si ya hay registro hoy
        const _todayId = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (this._hayRegistroEnFecha(_todayId)) {
            document.getElementById('workBanner')?.classList.remove('show');
            localStorage.setItem('lastRegisteredDate', _todayId);
        }
        document.getElementById('horasTrabajadas').textContent = horas.toFixed(1);
        document.getElementById('horasRestantes').textContent  = restantes.toFixed(1);
        document.getElementById('porcentaje').textContent = Math.min(Math.round(pct), 100);
        document.getElementById('progressFill').style.width = Math.min(pct, 100) + '%';
        if (pct >= 100) document.getElementById('progressFill').style.background = 'linear-gradient(90deg,#27ae60,#229954)';
        // Festivos + horas extras
        const pctExt = t.topeExtras > 0 ? (t.extras / t.topeExtras) * 100 : 0;
        const elF = document.getElementById('statFestivos');
        const elFS= document.getElementById('statFestivosSub');
        const elE = document.getElementById('statExtras');
        const elES= document.getElementById('statExtrasSub');
        if (elF)  elF.textContent  = t.festivo.toFixed(1);
        if (elFS) {
            const dias = t.diasFestivos === 1 ? '1 día festivo' : `${t.diasFestivos} días festivos`;
            elFS.textContent = t.importeDiasExtra > 0
                ? `${dias} · ${t.diasExtra} día${t.diasExtra === 1 ? '' : 's'} extra: ${t.importeDiasExtra.toFixed(2)}€`
                : dias;
        }
        if (elE)  elE.textContent  = t.extras.toFixed(1);
        if (elES) {
            const importe = this.precioExtraDefault > 0
                ? ` · ${(t.extras * this.precioExtraDefault).toFixed(2)}€` : '';
            elES.textContent = `de ${t.topeExtras.toFixed(1)}h${importe}`;
        }
        const barExt = document.getElementById('progressFillExtra');
        if (barExt) barExt.style.width = Math.min(pctExt, 100) + '%';
        this._actualizarPrUI();
        const pctExtEl = document.getElementById('porcentajeExtra');
        if (pctExtEl) pctExtEl.textContent = Math.min(Math.round(pctExt), 100);
        const ahora = new Date();
        const mesStats = this._calcMesStats(this._historialFull, ahora.getFullYear(), ahora.getMonth() + 1);
        const elMesH = document.getElementById('statMesHoras');
        const elMesN = document.getElementById('statMesNoche');
        if (elMesH) elMesH.textContent = mesStats.horas.toFixed(1);
        if (elMesN) elMesN.textContent = mesStats.nocturnas.toFixed(1);
        this._renderMensual(this._historialFull);
        this.actualizarHistorial(datos.historial || {});
        if (datos.prefs?.horaInicio && !localStorage.getItem('lastHoraInicio')) {
            localStorage.setItem('lastHoraInicio', datos.prefs.horaInicio);
            document.getElementById('horaInicio').value = datos.prefs.horaInicio;
        }
        if (datos.prefs?.horaFin && !localStorage.getItem('lastHoraFin')) {
            localStorage.setItem('lastHoraFin', datos.prefs.horaFin);
            document.getElementById('horaFin').value = datos.prefs.horaFin;
            if (datos.prefs.horaInicio) this.calcularHorasPorTiempo();
        }
    },

    actualizarHistorial(historial) {
        this._historialMap = {};
        Object.entries(historial).forEach(([id, reg]) => { this._historialMap[id] = reg; });
        const count = Object.keys(historial).length;
        const badge = document.getElementById('historialCount');
        if (badge) badge.textContent = count > 0 ? `${count} registros` : 'Sin registros';
    },


    // ── Cuadrante ────────────────────────────────────────────────────────────

    CUADRANTE_URL: 'https://registro-horario-emt.vercel.app/api/cuadrante',

    async _cargarCuadrante() {
        try {
            const resp = await fetch(this.CUADRANTE_URL, { cache: 'no-store' });
            if (!resp.ok) return;
            const data = await resp.json();
            this._pintarCuadrante(data);
            if (data?.imagen) localStorage.setItem('cuadranteCache', JSON.stringify(data));
        } catch (_) {
            // Offline: fall back to the last one we saw
            try {
                const cache = JSON.parse(localStorage.getItem('cuadranteCache') || 'null');
                if (cache) this._pintarCuadrante(cache);
            } catch (__) {}
        }
    },

    _pintarCuadrante(data) {
        const img   = document.getElementById('cuadImg');
        const vacio = document.getElementById('cuadVacio');
        const fecha = document.getElementById('cuadFecha');
        const borrar= document.getElementById('cuadBorrar');
        const hay = !!(data && data.imagen);
        if (img)   { img.style.display = hay ? 'block' : 'none'; if (hay) img.src = data.imagen; }
        if (vacio) vacio.style.display = hay ? 'none' : 'flex';
        if (borrar) borrar.style.display = hay ? 'inline-block' : 'none';
        if (fecha) {
            fecha.textContent = hay && data.actualizado
                ? new Date(data.actualizado).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
                : '';
        }
    },

    verCuadranteGrande() {
        const img = document.getElementById('cuadImg');
        if (!img?.src) return;
        document.getElementById('cuadVisorImg').src = img.src;
        document.getElementById('cuadVisor').classList.add('show');
    },


    zoomCuadrante(ev) {
        const img = document.getElementById('cuadVisorImg');
        if (!img) return;
        const ampliada = img.classList.toggle('zoom');
        const ayuda = document.getElementById('cuadVisorAyuda');
        if (ayuda) ayuda.textContent = ampliada
            ? 'Arrastra para moverte · toca para reducir'
            : 'Toca la imagen para ampliar · pellizca para acercar';
        // Al ampliar, centrar en el punto tocado
        if (ampliada && ev) {
            const visor = document.getElementById('cuadVisor');
            requestAnimationFrame(() => {
                visor.scrollLeft = (img.scrollWidth - visor.clientWidth) / 2;
                visor.scrollTop  = Math.max(0, ev.offsetY * (img.clientHeight / (img.clientHeight || 1)) - visor.clientHeight / 2);
            });
        }
    },

    cerrarCuadranteGrande() {
        document.getElementById('cuadVisor')?.classList.remove('show');
        document.getElementById('cuadVisorImg')?.classList.remove('zoom');
    },


    // ── Resumen para la app de gestión ───────────────────────────────────────

    USUARIOS_URL: 'https://registro-horario-emt.vercel.app/api/usuarios',

    // Turno según la hora de entrada habitual: mañana 6–13, tarde 13–20
    _minutos(hhmm) {
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
    },

    // Normaliza "Son Rossinyol", "SON ROSSINYOL", "son rossinyol " al mismo valor
    _clavePuesto(puesto) {
        return String(puesto || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },

    // Turno según el puesto y la hora de entrada registrada. Si el puesto no
    // está en la tabla, se cae al criterio antiguo (mañana antes de las 13h).
    // La noche es 21:00–06:00 en cualquier lugar. Mañana y tarde admiten una
    // hora de margen: entrar una hora antes sigue siendo mañana y salir una
    // hora más tarde sigue siendo tarde. En los lugares que entran de
    // madrugada (Son Rossinyol a las 3:45) la noche termina donde empieza su
    // mañana con el margen, o de lo contrario se las tragaría enteras.
    NOCHE_DESDE: 21 * 60,
    NOCHE_HASTA: 6 * 60,
    MARGEN_TURNO: 60,

    _franjasDe(puesto) {
        return (TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || []).filter(f => f.id !== 'N');
    },

    // La franja de noche tal y como la tiene puesta ese lugar, si la tiene
    _nocheDe(puesto) {
        const n = (TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || []).find(f => f.id === 'N');
        return (n && this._minutos(n.desde) !== null && this._minutos(n.hasta) !== null) ? n : null;
    },

    // Hora a la que deja de ser de noche en este lugar: nunca más tarde de las 6
    _amanecerDe(puesto) {
        const m = this._franjasDe(puesto).find(f => f.id === 'M');
        const ini = m ? this._minutos(m.desde) : null;
        if (ini === null) return this.NOCHE_HASTA;
        return Math.min(this.NOCHE_HASTA, Math.max(0, ini - this.MARGEN_TURNO));
    },

    // Una franja puede cruzar la medianoche —la noche siempre lo hace—, así
    // que se estira hasta el día siguiente antes de comparar.
    _dentroDeFranja(min, f, margen) {
        const desde = this._minutos(f?.desde), hasta = this._minutos(f?.hasta);
        if (desde === null || hasta === null || desde === hasta) return false;
        let a = desde - margen, b = hasta + margen;
        if (b <= a) b += 1440;
        let cur = min;
        if (cur < a) cur += 1440;
        return cur >= a && cur < b;
    },

    // Manda la hora que tenga puesta el lugar: Son Rossinyol y Control entran
    // de noche a las 20:00, y dándola por hecha a las 21:00 esas entradas
    // caían en la tarde. El turno de noche se quedaba sin nadie y el cuadro
    // de lugares marcaba "sin cubrir" con el trabajador dentro.
    _esNoche(min, puesto) {
        const n = this._nocheDe(puesto);
        if (n) return this._dentroDeFranja(min, n, 0);
        return min >= this.NOCHE_DESDE || min < this._amanecerDe(puesto);
    },

    _turnoDe(puesto, horaInicio) {
        const ini = this._minutos(horaInicio);
        if (ini === null) return '';
        const todas = TURNOS_POR_PUESTO[this._clavePuesto(puesto)] || [];
        // Primero la hora clavada, y solo si no encaja en ninguna se admite
        // la hora de margen: entrar un poco antes o salir un poco después
        // sigue siendo el mismo turno.
        for (const f of todas) if (this._dentroDeFranja(ini, f, 0)) return f.id;
        for (const f of todas) if (this._dentroDeFranja(ini, f, this.MARGEN_TURNO)) return f.id;
        if (this._esNoche(ini, puesto)) return 'N';
        return ini < 13 * 60 ? 'M' : 'T';
    },

    _turnoHabitual(delMes) {
        // Turno del último día con horario registrado, según el puesto asignado
        const conHora = delMes.filter(r => r.horaInicio).sort((a, b) => b.timestamp - a.timestamp);
        if (!conHora.length) return '';
        return this._turnoDe(this.puestoTrabajo, conHora[0].horaInicio);
    },

    async _cargarLugares() {
        try {
            const r = await fetch(LUGARES_URL, { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            const data = await r.json();
            if (data && typeof data === 'object') {
                aplicarCatalogoLugares(data);
                localStorage.setItem('lugaresCatalogo', JSON.stringify(data));
            }
        } catch (_) {
            // Sin red se tira de lo último que se vio, que es mejor que nada
            try { aplicarCatalogoLugares(JSON.parse(localStorage.getItem('lugaresCatalogo') || '{}')); } catch (_) {}
        }
    },

    // Lugar del catálogo cuya ubicación cae más cerca, dentro de su radio. Si
    // hay varios en el mismo sitio (control y taller comparten nave) gana el de
    // prioridad más alta, que es donde suele estar la gente.
    _lugarPorUbicacion(lat, lng) {
        let mejor = null;
        Object.values(LUGARES_CATALOGO || {}).forEach(l => {
            const u = l?.ubicacion;
            if (!u) return;
            const d = this.calcularDistancia(lat, lng, u.lat, u.lng);
            if (d > u.radio) return;
            if (!mejor || (l.prioridad || 0) > mejor.prioridad
                || ((l.prioridad || 0) === mejor.prioridad && d < mejor.d)) {
                mejor = { nombre: l.nombre, prioridad: l.prioridad || 0, d };
            }
        });
        return mejor;
    },

    _posicionActual() {
        return new Promise(resolve => {
            const Geo = window.Capacitor?.Plugins?.Geolocation || navigator.geolocation;
            if (!Geo) return resolve(null);
            let hecho = false;
            const ok = c => { if (!hecho) { hecho = true; resolve({ lat: c.coords?.latitude ?? c.latitude, lng: c.coords?.longitude ?? c.longitude }); } };
            const fallo = () => { if (!hecho) { hecho = true; resolve(null); } };
            try {
                if (Geo.getCurrentPosition.length === 0) Geo.getCurrentPosition().then(ok).catch(fallo);
                else Geo.getCurrentPosition(ok, fallo, { enableHighAccuracy: true, timeout: 8000 });
            } catch (_) { fallo(); }
            setTimeout(fallo, 9000);
        });
    },

    // Al registrar, si estás en un lugar conocido y no es el que tienes puesto,
    // se te pregunta. Confirmarlo lo cambia también en gestión.
    async _comprobarLugarPorUbicacion() {
        if (!Object.keys(LUGARES_CATALOGO || {}).length) return;
        const pos = await this._posicionActual();
        if (!pos) return;
        const cerca = this._lugarPorUbicacion(pos.lat, pos.lng);
        if (!cerca) return;
        const puesto = this.puestoTrabajo;
        if (this._clavePuesto(cerca.nombre) === this._clavePuesto(puesto)) return;
        // Donde estás manda sobre lo que hayas elegido: si el GPS te sitúa en
        // otro sitio, cuenta ese. Se avisa, no se pregunta.
        this.puestoTrabajo = cerca.nombre;
        localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
        this._marcarLugarElegidoHoy();
        this._actualizarCabeceraUsuario();
        this._actualizarConductorDisplay();
        this._renderLugarJornada();
        localStorage.removeItem('resumenHuella');     // forzar que se vuelva a publicar
        this._publicarResumen();
        this._mostrarToast(puesto
            ? `📍 El GPS te sitúa en ${cerca.nombre}: cuenta ese, no ${puesto}`
            : `📍 Lugar: ${cerca.nombre}`, 5000);
    },

    async _publicarResumen() {
        if (!this.usuarioActual?.email) return;
        if (this._lecturaOk === false) return;   // no mandar lo que no se ha podido leer
        try {
            const hist = this._historialFull || {};
            const ahora = new Date();
            const delMes = Object.values(hist).filter(r => {
                const d = new Date(r.timestamp);
                return d.getFullYear() === ahora.getFullYear() && d.getMonth() === ahora.getMonth();
            });
            const t = this._calcTotales(hist);
            // Horario de hoy si lo hay; si no, el del último día registrado.
            // Gestión lo usa para ver si el puesto queda cubierto.
            const hoyId = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const deHoy = Object.entries(hist)
                .filter(([id]) => this._fechaDeId(id) === hoyId)
                .map(([, r]) => r);
            const ultimo = deHoy.length ? deHoy[deHoy.length - 1]
                : Object.values(hist).sort((a, b) => b.timestamp - a.timestamp)[0];
            // Jornadas del año en curso, compactas: gestión las agrupa por mes.
            // Claves cortas a propósito, son ~220 al año por trabajador.
            // Desde el 1 de enero del año en curso
            const desde = new Date(ahora.getFullYear(), 0, 1).getTime();
            const jornadas = Object.entries(hist)
                .filter(([, r]) => r.timestamp && r.timestamp >= desde)
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .map(([id, r]) => ({
                    f: this._fechaDeId(id),
                    h: parseFloat(r.horas) || 0,
                    i: r.horaInicio || '',
                    o: r.horaFin || '',
                    n: r.horasNocturnas || 0,
                    pu: r.puesto || this.puestoTrabajo || '',
                    ...(r.extraManual ? { x: r.extraDestino === 'extras' ? 1 : 2 } : {}),
                    ...(r.festivo ? { fe: 1 } : {}),
                    ...(r.vacaciones ? { v: 1 } : {}),
                    ...(r.be ? { b: 1 } : {}),
                    ...(Array.isArray(r.tramos) && r.tramos.length ? { tr: r.tramos } : {}),
                    ...(r.pr ? { p: 1 } : {}),
                }));
            const payload = {
                nombre:       this.usuarioActual.name || '',
                conductor:    this.numConductor || '',
                avatar:       localStorage.getItem('avatarPhoto') || null,
                version:      (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '',
                horasMes:     Math.round(delMes.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0) * 10) / 10,
                horasTotales: t.anualReal,
                horasAnuales: this.horasAnualesCustom,
                diasMes:      delMes.length,
                jornadaHoras: this.jornadaHoras,
                dias:         this.diasSemana || null,
                diasAt:       this._diasAt(),
                // Las vacaciones también viajaban solo hacia el trabajador: el
                // servidor las arbitra por fecha, pero nunca le llegaban.
                vacaciones:   this._getVacaciones(),
                vacacionesAt: this._vacacionesAt(),
                turno:        this._turnoHabitual(delMes),
                horaInicio:   ultimo?.horaInicio || '',
                horaFin:      ultimo?.horaFin || '',
                horarioDe:    deHoy.length ? 'hoy' : 'anterior',
                jornadas,
            };
            // Publicar cuando algo cambie de verdad, no una vez al día: si no, al
            // actualizar la app el nuevo número de versión no llegaba a gestión
            // hasta el día siguiente. Sin cambios no se escribe nada.
            const huella = JSON.stringify([payload.version, payload.horasMes, payload.horasTotales,
                                           payload.diasMes, payload.turno, payload.conductor, payload.horasAnuales,
                                           payload.jornadaHoras, JSON.stringify(payload.dias), JSON.stringify(payload.vacaciones),
                                           payload.nombre, payload.horaInicio, payload.horaFin,
                                           payload.horarioDe, jornadas.length,
                                           jornadas.length ? jornadas[jornadas.length - 1].f : '',
                                           new Date().toISOString().slice(0, 10)]);
            if (localStorage.getItem('resumenHuella') === huella) return;
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-User-Email': this.usuarioActual.email },
                body: JSON.stringify(payload)
            });
            if (resp.ok) {
                localStorage.setItem('resumenHuella', huella);
                const mio = await resp.json();
                if (Array.isArray(mio?.vacaciones)
                    && (mio.vacacionesAt || 0) > this._vacacionesAt()) {
                    localStorage.setItem('vacacionesAt', String(mio.vacacionesAt));
                    this._saveVacaciones(mio.vacaciones, true);
                    this._renderVacaciones();
                    this._aplicarModoVacaciones();
                }
                if ((mio?.diasAt || 0) > this._diasAt()) {
                    localStorage.setItem('diasSemanaAt', String(mio.diasAt));
                    this.diasSemana = Array.isArray(mio.dias) ? mio.dias : null;
                    if (this.diasSemana) localStorage.setItem('diasSemana', JSON.stringify(this.diasSemana));
                    else localStorage.removeItem('diasSemana');
                }
                const grupo = Number(mio?.grupo) || null;
                if (grupo !== this.grupoDescanso) {
                    this.grupoDescanso = grupo;
                    if (grupo) localStorage.setItem('grupoDescanso', String(grupo));
                    else localStorage.removeItem('grupoDescanso');
                    this._actualizarCampoFestivo();
                }
                if (mio?.puesto !== undefined) {
                    this.puestoTrabajo = mio.puesto || '';
                    localStorage.setItem('puestoTrabajo', this.puestoTrabajo);
                    this._actualizarCabeceraUsuario();
                    this._actualizarConductorDisplay();
                }
            }
        } catch (_) { /* silencioso: se reintenta al día siguiente */ }
    },

    toggleMensual() {
        const sec = document.getElementById('mensualSection');
        if (!sec) return;
        const cerrada = sec.classList.toggle('cerrada');
        localStorage.setItem('mensualCerrada', cerrada ? '1' : '0');
    },

    _restaurarMensual() {
        if (localStorage.getItem('mensualCerrada') === '1')
            document.getElementById('mensualSection')?.classList.add('cerrada');
    },

    _renderMensual(historial) {
        const container = document.getElementById('mensualTable');
        if (!container) return;
        const meses = this._calcTodosMeses(historial);
        const keys  = Object.keys(meses).sort((a, b) => b.localeCompare(a)).slice(0, 6);
        if (keys.length === 0) { container.innerHTML = '<div style="text-align:center;color:#95a5a6;font-size:12px;padding:8px;">Sin datos</div>'; return; }
        container.innerHTML = keys.map(k => {
            const m = meses[k];
            const objetivo = this.horasAnualesCustom / 12;
            const barPct   = Math.min((m.horas / objetivo) * 100, 100);
            // Split the bar proportionally, so the orange slice reflects how much
            // of that month's hours were overtime even when the bar is saturated
            const ratioExt = m.horas > 0 ? Math.min(m.horasExtras / m.horas, 1) : 0;
            const extPct   = barPct * ratioExt;
            const normPct  = barPct - extPct;
            return `<div class="mes-row">
                <div class="mes-label">${m.label}</div>
                <div class="mes-bar-wrap">
                    <div class="mes-bar" style="width:${normPct}%"></div>
                    <div class="mes-bar-extra" style="width:${extPct}%"></div>
                </div>
                <div class="mes-vals">
                    <span>${m.horas}h</span>
                    ${m.horasExtras > 0 ? `<span class="mes-extras-h">⏱️${m.horasExtras}h</span>` : ''}
                    ${m.horasExtras > 0 && this.precioExtraDefault > 0 ? `<span class="mes-extras-e">+${(m.horasExtras * this.precioExtraDefault).toFixed(2)}€</span>` : ''}
                    ${m.nocturnas > 0 ? `<span class="mes-noche">🌙${m.nocturnas}h</span>` : ''}
                    ${m.extra > 0    ? `<span class="mes-extra">+${m.extra.toFixed(2)}€</span>` : ''}
                </div>
            </div>`;
        }).join('');
    },

    revisarSuma() {
        const t = parseFloat(document.getElementById('horasTrabajadas').textContent);
        const r = parseFloat(document.getElementById('horasRestantes').textContent);
        const s = t + r;
        if (Math.abs(s - this.horasAnualesCustom) < 0.1) alert(`✅ Suma correcta!\n\nTrabajadas: ${t}h\nRestantes: ${r}h`);
        else alert(`❌ Error!\n\nTrabajadas: ${t}h\nRestantes: ${r}h\nTotal: ${s}h\nEsperado: ${this.horasAnualesCustom}h`);
    },

    toggleDarkMode() {
        this.darkMode = !this.darkMode;
        localStorage.setItem('darkMode', this.darkMode);
        this.darkMode ? this.aplicarDarkMode() : this.removerDarkMode();
        this._guardarPreferencias();
    },

    aplicarDarkMode() {
        document.body.classList.add('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#historialModalContent','#avatarModalContent']
            .forEach(s => { const e = document.querySelector(s); if(e) e.classList.add('dark'); });
        document.querySelector('.container')?.classList.add('dark');
    },

    removerDarkMode() {
        document.body.classList.remove('dark');
        ['#appHeader','#appContent','#tabBar','#optionsHeader','#optionsContent','#modalContent',
         '#editModalContent','#historialModalContent','#avatarModalContent']
            .forEach(s => { const e = document.querySelector(s); if(e) e.classList.remove('dark'); });
        document.querySelector('.container')?.classList.remove('dark');
    },

    seleccionarTema(tema) {
        this.tema = tema;
        localStorage.setItem('tema', tema);
        this.aplicarTema(tema);
        this._guardarPreferencias();
        this._actualizarTemaUI();
    },

    aplicarTema(tema) {
        document.body.classList.remove('theme-verde','theme-fuego','theme-acero','theme-rojo');
        if (tema && tema !== 'azul') document.body.classList.add('theme-' + tema);
    },

    _actualizarTemaUI() {
        ['azul','verde','fuego','acero','rojo'].forEach(t => {
            const dot = document.getElementById('dot-' + t);
            if (dot) dot.classList.toggle('active', t === this.tema);
        });
    },

    async guardarPrecioExtra() {
        const precio = this._leerDecimal(document.getElementById('precioExtraGlobal').value) || 0;
        this.precioExtraDefault = precio;
        localStorage.setItem('precioExtra', String(precio));
        // Esperar al guardado: cargarDatos relee Drive, y si aún tenía el valor
        // viejo lo volvía a aplicar encima del que se acababa de escribir.
        await this._guardarPreferencias(true);
        this.cargarDatos();
    },

    async guardarPrecioFestivo() {
        const precio = this._leerDecimal(document.getElementById('precioFestivoGlobal').value) || 0;
        this.precioFestivoDefault = precio;
        localStorage.setItem('precioFestivo', String(precio));
        // Sin flush, salir de Ajustes antes de los 2 s del guardado diferido
        // dejaba el precio solo en el móvil, y al reabrir Drive lo pisaba.
        // Esperar al guardado: cargarDatos relee Drive, y si aún tenía el valor
        // viejo lo volvía a aplicar encima del que se acababa de escribir.
        await this._guardarPreferencias(true);
        this.cargarDatos();
    },

    // Quién trabaja festivos y libres no se puede deducir de las horas de la
    // jornada: hay un grupo que hace 7h tres días a la semana y va por las
    // mismas reglas que la media jornada. Lo que los separa son las anuales.
    ANUALES_COMPLETA: 1700,
    // A partir de aquí es jornada completa; por debajo, media
    JORNADA_COMPLETA: 7,

    _esJornadaCompleta() {
        return this.horasAnualesCustom >= this.ANUALES_COMPLETA;
    },

    _actualizarCampoFestivo() {
        const campo = document.getElementById('campoPrecioFestivo');
        if (campo) campo.hidden = !this._esJornadaCompleta();
        const inp = document.getElementById('precioFestivoGlobal');
        if (inp && this.precioFestivoDefault > 0) inp.value = this.precioFestivoDefault;

        // Los días fijos son cosa de quien va por las 777h —tanto el de 3,5h
        // como el que hace 7h tres días—, y el grupo de libres, de la jornada
        // completa. Nunca se enseñan los dos.
        const completa = this._esJornadaCompleta();
        this._actualizarTituloFestivos();
        const btnDias = document.getElementById('btnDiasJornada');
        if (btnDias) btnDias.hidden = completa;
        const txtDias = document.getElementById('diasJornadaDisplay');
        if (txtDias) txtDias.textContent = this._etiquetaDias();

        const campoGr = document.getElementById('campoGrupoDescanso');
        if (campoGr) campoGr.hidden = !completa;
        const txtGr = document.getElementById('grupoDescansoDisplay');
        if (txtGr) txtGr.textContent = this.grupoDescanso ? 'Grupo ' + this.grupoDescanso : 'sin asignar';
    },

    async guardarPrecioNoche() {
        const precio = this._leerDecimal(document.getElementById('precioNocheGlobal').value) || 0;
        this.precioNocheDefault = precio;
        localStorage.setItem('precioNoche', precio);
        await this._guardarPreferencias(true);
    },

    async guardarFechaAlta() {
        const valor = document.getElementById('fechaAltaGlobal')?.value || '';
        this.fechaAltaDefault = valor;
        localStorage.setItem('fechaAlta', valor);
        this._renderMiNomina();
        await this._guardarPreferencias(true);
    },

    async guardarPctBieniosManual() {
        const pct = this._leerDecimal(document.getElementById('pctBieniosGlobal').value) || 0;
        this.pctBieniosDefault = pct;
        localStorage.setItem('pctBieniosManual', String(pct));
        this._renderMiNomina();
        await this._guardarPreferencias(true);
    },

    mostrarCambiarAnuales() {
        document.querySelectorAll('#anualesModal .jm-op').forEach(op => {
            const c = op.querySelector('.jm-check');
            op.classList.toggle('sel', !!c && parseFloat(c.dataset.an) === this.horasAnualesCustom);
        });
        document.getElementById('anualesModal').classList.add('show');
        if (this.darkMode) document.getElementById('anualesModalContent').classList.add('dark');
    },

    elegirAnualesOtra() {
        const v = prompt('¿Cuántas horas quieres trabajar al año?', this.horasAnualesCustom);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        this.elegirAnuales(n);
    },

    async elegirAnuales(n) {
        document.getElementById('anualesModal').classList.remove('show');
        if (n === this.horasAnualesCustom) return;
        this.horasAnualesCustom = n;
        localStorage.setItem('horasAnuales', String(n));
        const el = document.getElementById('horasAnualesDisplay');
        if (el) el.textContent = n + 'h';
        this._actualizarCampoFestivo();      // el precio del día extra depende de esto
        await this._guardarPreferencias(true);
        this.cargarDatos();
        this._mostrarToast(`✅ Horas anuales: ${n}h`, 2500);
    },

    confirmarResetear() {
        this.mostrarModal('⚠️ Resetear Contador', '¿Estás seguro? Se pondrán todas las horas a 0.', this.resetearContador.bind(this));
    },

    mostrarModal(titulo, mensaje, callback) {
        document.getElementById('modalTitle').textContent   = titulo;
        document.getElementById('modalMessage').textContent = mensaje;
        document.getElementById('modal').classList.add('show');
        this.modalCallback = callback;
    },

    cerrarModal()       { document.getElementById('modal').classList.remove('show'); this.modalCallback = null; },
    async confirmarModal() { if (this.modalCallback) await this.modalCallback(); this.cerrarModal(); },

    confirmarBorrarCuenta() {
        this.mostrarModal('⚠️ Borrar datos', 'Se eliminarán todos tus registros de Drive y se cerrará la sesión.', this.borrarCuenta.bind(this));
    },

    // Cuándo volver a avisar de que estás en el trabajo:
    //   'cada' — en cada lugar del día, pero no otra vez donde ya registraste
    //   'una'  — una sola vez al día, y solo en el lugar de siempre
    avisoLugar: localStorage.getItem('avisoLugar') || 'cada',

    // Los lugares en los que ya ha registrado hoy, por nombre. De aquí sale
    // que no vuelva a avisar donde ya ha fichado pero sí en uno nuevo.
    _lugaresRegistradosHoy() {
        const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const sitios = new Set();
        Object.entries(this._historialFull || {}).forEach(([id, r]) => {
            if (this._fechaDeId(id) !== hoy) return;
            if (r.puesto) sitios.add(this._clavePuesto(r.puesto));
            (r.tramos || []).forEach(t => { if (t?.p) sitios.add(this._clavePuesto(t.p)); });
        });
        // Y la ubicación guardada que corresponda a cada uno, por si el aviso
        // nativo compara por el nombre que se le puso al GPS.
        this._getWorkLocations().forEach((loc, i) => {
            if (sitios.has(this._clavePuesto(this._nombreDeUbicacion(i)))) {
                sitios.add(this._clavePuesto(loc.name || ''));
            }
        });
        sitios.delete('');
        return sitios;
    },

    // Cómo se llama de verdad la ubicación `i`: el nombre que se le puso al
    // guardarla puede no ser el del cuadrante —"Trabajo" contra "Control"—, y
    // comparando esos nombres el aviso no callaba nunca. Si cae dentro de un
    // lugar del catálogo, manda el nombre del catálogo.
    _nombreDeUbicacion(i) {
        const loc = this._getWorkLocations()[i];
        if (!loc) return '';
        let mejor = '', cerca = Infinity;
        Object.values(LUGARES_CATALOGO || {}).forEach(l => {
            if (!l?.ubicacion || !l?.nombre) return;
            const d = this.calcularDistancia(loc.lat, loc.lng, l.ubicacion.lat, l.ubicacion.lng);
            if (d < Math.max(300, l.ubicacion.radio || 0) && d < cerca) { cerca = d; mejor = l.nombre; }
        });
        return mejor || loc.name || '';
    },

    // ¿Toca avisar por este lugar? `i` es su sitio en la lista de ubicaciones.
    _tocaAvisar(i) {
        const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        // Una jornada a medias es la que se ha empezado y no se ha cerrado:
        // mientras no tenga salida, sigue teniendo sentido avisar.
        if (this.avisoLugar === 'una') {
            if (i !== 0) return false;
            return localStorage.getItem('lastRegisteredDate') !== hoy
                && !this._hayRegistroEnFecha(hoy);
        }
        const nombre = this._clavePuesto(this._nombreDeUbicacion(i));
        if (!nombre) return !this._hayRegistroEnFecha(hoy);
        return !this._lugaresRegistradosHoy().has(nombre);
    },

    // Lo mismo, para el aviso nativo que corre con la app cerrada
    _publicarLugaresHoy() {
        const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const sitios = [...this._lugaresRegistradosHoy()].join('|');
        window.AndroidBridge?.saveToPrefs?.('avisoLugar', this.avisoLugar);
        window.AndroidBridge?.saveToPrefs?.('lugaresHoy', `${hoy}~${sitios}`);
    },

    _getWorkLocations() { return JSON.parse(localStorage.getItem('workLocations') || '[]'); },
    _saveWorkLocations(locs) { localStorage.setItem('workLocations', JSON.stringify(locs)); },

    async guardarUbicacionTrabajo() {
        const name = prompt('Nombre de esta ubicación (ej: EMT Madrid, Depósito):');
        if (!name) return;
        if (!navigator.geolocation) { alert('❌ Tu dispositivo no soporta geolocalización'); return; }
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) await LN.requestPermissions().catch(() => {});
        else if ('Notification' in window && Notification.permission === 'default')
            await Notification.requestPermission();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const locs = this._getWorkLocations();
                locs.push({ name: name.trim(), lat: pos.coords.latitude, lng: pos.coords.longitude });
                this._saveWorkLocations(locs);
                this._guardarPreferencias();
                this.actualizarEstadoGPS();
                this._renderWorkLocations();
                alert(`✅ "${name.trim()}" guardada. Recibirás notificación al llegar.`);
                if (!this._bgGeoStarted) this._iniciarGeofencingNativo();
            },
            () => alert('❌ No se pudo obtener la ubicación. Activa el GPS.')
        );
    },

    borrarUbicacion(index) {
        const locs = this._getWorkLocations();
        if (!confirm(`¿Eliminar "${locs[index].name}"?`)) return;
        locs.splice(index, 1);
        this._saveWorkLocations(locs);
        this._guardarPreferencias();
        if (locs.length === 0) document.getElementById('workBanner').classList.remove('show');
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
    },

    async editarUbicacion(index) {
        const locs = this._getWorkLocations();
        const loc  = locs[index];
        const nuevoNombre = prompt('Nombre de la ubicación:', loc.name);
        if (nuevoNombre === null) return;
        if (!nuevoNombre.trim()) { alert('❌ El nombre no puede estar vacío'); return; }
        loc.name = nuevoNombre.trim();
        const actualizarGPS = confirm('¿Actualizar también las coordenadas GPS a tu posición actual?');
        if (actualizarGPS) {
            await new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    (pos) => { loc.lat = pos.coords.latitude; loc.lng = pos.coords.longitude; resolve(); },
                    ()    => { alert('❌ No se pudo obtener la ubicación'); resolve(); }
                );
            });
        }
        locs[index] = loc;
        this._saveWorkLocations(locs);
        this._guardarPreferencias();
        this.actualizarEstadoGPS();
        this._renderWorkLocations();
    },

    _renderWorkLocations() {
        const container = document.getElementById('workLocationsList');
        if (!container) return;
        const locs = this._getWorkLocations();
        if (locs.length === 0) {
            container.innerHTML = '<div style="font-size:12px;color:#95a5a6;padding:4px 0;">Sin ubicaciones guardadas</div>';
            return;
        }
        const isDark = this.darkMode;
        container.innerHTML = locs.map((loc, i) => {
            const latStr = loc.lat.toFixed(5);
            const lngStr = loc.lng.toFixed(5);
            const mapUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
            return `
            <div style="background:${isDark?'#111827':'#f8f9ff'};border:1px solid ${isDark?'#2d3561':'#e0e4ff'};border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span style="font-size:13px;font-weight:700;color:${isDark?'#e0e0e0':'#2c3e50'};">📍 ${loc.name}</span>
                    <div style="display:flex;gap:6px;">
                        <button onclick="app.editarUbicacion(${i})" style="background:var(--ac);color:white;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600;">✏️ Editar</button>
                        <button onclick="app.borrarUbicacion(${i})" style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-weight:600;">🗑️</button>
                    </div>
                </div>
                <div style="font-size:11px;color:#7f8c8d;margin-bottom:4px;">🌐 ${latStr}, ${lngStr}</div>
                <a href="${mapUrl}" target="_blank" rel="noopener" style="font-size:11px;color:var(--ac);text-decoration:none;font-weight:600;">📌 Ver en Google Maps →</a>
            </div>`;
        }).join('');
    },

    actualizarEstadoGPS() {
        const locs = this._getWorkLocations();
        const el   = document.getElementById('gpsStatus');
        if (!el) return;
        if (locs.length > 0) {
            el.textContent = `✅ ${locs.length} ubicación${locs.length > 1 ? 'es' : ''} guardada${locs.length > 1 ? 's' : ''}`;
            el.className = 'gps-badge saved';
        } else {
            el.textContent = 'Sin ubicaciones'; el.className = 'gps-badge none';
        }
    },

    verificarUbicacion() {
        const locs = this._getWorkLocations();
        if (locs.length === 0 || !navigator.geolocation) return;
        if (this.gpsMode === 'off') return;
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            const i = locs.findIndex(loc =>
                this.calcularDistancia(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lng) < 300);
            if (i === -1 || !this._tocaAvisar(i)) return;
            document.getElementById('workBanner').classList.add('show');
            this._enviarNotificacionTrabajo();
        }, () => {});
    },

    async _enviarNotificacionTrabajo() {
        if (window.AndroidBridge?.scheduleWorkNotification) {
            const inicio = localStorage.getItem('lastHoraInicio') || '';
            const fin    = localStorage.getItem('lastHoraFin') || '';
            window.AndroidBridge.scheduleWorkNotification(inicio, fin);
            return;
        }
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                const notif = {
                    id: 1001,
                    title: '📍 EMT - Movilidad',
                    body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                    actionTypeId: 'TRABAJO_CERCANO',
                };
                if (this.notifSound && this.notifSound !== 'default') {
                    notif.sound = this.notifSound;
                    notif.channelId = this.notifSound;
                }
                await LN.schedule({ notifications: [notif] });
            } catch(e) { console.error('Notification error:', e); }
            return;
        }
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification('📍 EMT - Movilidad', {
                body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'trabajo-cercano', requireInteraction: true,
                actions: [{ action: 'abrir', title: 'Abrir app' }]
            });
        } catch(_) {
            new Notification('📍 EMT - Movilidad', { body: 'Parece que estás en el trabajo.', icon: '/icons/icon-192.png' });
        }
    },

    async _iniciarGeofencingNativo() {
        const BGGeo = window.Capacitor?.Plugins?.BackgroundGeolocation;
        if (!BGGeo) return;
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) { try { await LN.requestPermissions(); } catch(_) {} }
        try {
            this._geoWatcherId = await BGGeo.addWatcher({
                backgroundMessage: '',
                backgroundTitle: 'EMT - Movilidad',
                requestPermissions: true,
                stale: false,
                distanceFilter: 200
            }, (location, error) => {
                if (error || !location) return;
                const ahora = Date.now();
                if (ahora - this._lastGeoCheck < this.gpsInterval * 60 * 1000) return;
                this._lastGeoCheck = ahora;
                const locs = this._getWorkLocations();
                if (locs.length === 0) return;
                const cual = locs.findIndex(loc =>
                    this.calcularDistancia(location.latitude, location.longitude, loc.lat, loc.lng) < 300
                );
                if (cual !== -1 && this._tocaAvisar(cual)) {
                    this._notifEnviadaAt = ahora;
                    const inicio = localStorage.getItem('lastHoraInicio') || '';
                    const fin    = localStorage.getItem('lastHoraFin') || '';
                    if (window.AndroidBridge?.scheduleWorkNotification) {
                        window.AndroidBridge.scheduleWorkNotification(inicio, fin);
                    } else {
                        this._enviarNotificacionLlegadaNativa();
                    }
                }
            });
            this._bgGeoStarted = true;
        } catch(e) {
            console.error('Background geo error:', e);
        }
    },

    async _detenerGeofencingNativo() {
        const BGGeo = window.Capacitor?.Plugins?.BackgroundGeolocation;
        if (!BGGeo || !this._geoWatcherId) return;
        try {
            await BGGeo.removeWatcher({ id: this._geoWatcherId });
        } catch(e) {
            console.error('removeWatcher error:', e);
        }
        this._geoWatcherId = null;
        this._bgGeoStarted = false;
    },

    async _enviarNotificacionLlegadaNativa() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            const notif = {
                id: 1001,
                title: '📍 EMT - Movilidad',
                body: 'Parece que estás en el trabajo. ¿Registras la jornada de hoy?',
                actionTypeId: 'TRABAJO_CERCANO',
            };
            if (this.notifSound && this.notifSound !== 'default') {
                notif.sound = this.notifSound;
                notif.channelId = this.notifSound;
            }
            await LN.schedule({ notifications: [notif] });
        } catch(e) {
            console.error('Notification error:', e);
        }
    },

    async _cancelarNotificacionTrabajo() {
        window.AndroidBridge?.cancelWorkNotification?.();
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try { await LN.cancel({ notifications: [{ id: 1001 }] }); } catch(_) {}
    },

    async _setupNotificationActions() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN) return;
        try {
            await LN.registerActionTypes({
                types: [{
                    id: 'TRABAJO_CERCANO',
                    actions: [
                        { id: 'registro-rapido', title: '✅ Registrar jornada', foreground: false },
                        { id: 'otro-horario',    title: '🕐 Otro horario' }
                    ]
                }]
            });
            LN.addListener('localNotificationActionPerformed', (ev) => {
                if (ev.actionId === 'registro-rapido') {
                    if (this.usuarioActual) {
                        this._registrarDesdeNotificacion();
                    } else {
                        this._pendingNotifAction = 'registro-rapido';
                    }
                } else {
                    this._pendingNotifAction = null;
                    this.mostrarApp();
                    document.getElementById('workBanner')?.classList.remove('show');
                    setTimeout(() => document.getElementById('horasInput')?.focus(), 200);
                }
            });
        } catch(e) {
            console.error('registerActionTypes error:', e);
        }
    },

    async _registrarDesdeNotificacion() {
        const horaInicio = localStorage.getItem('lastHoraInicio');
        const horaFin    = localStorage.getItem('lastHoraFin');
        if (!horaInicio || !horaFin || !this.usuarioActual) return;
        const [h1, m1] = horaInicio.split(':').map(Number);
        const [h2, m2] = horaFin.split(':').map(Number);
        let minutos = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (minutos <= 0) minutos += 24 * 60;
        const horas = Math.round(minutos / 6) / 10;
        const fecha = new Date().toISOString().slice(0, 10);
        const registroId = fecha.replace(/-/g, '');
        try {
            const datos = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
            datos.horasTrabajadas = parseFloat(datos.horasTrabajadas) || 0;
            if (!datos.historial) datos.historial = {};
            if (datos.historial[registroId]) {
                this._mostrarToast('⚠️ Ya hay un registro para hoy', 3000);
                return;
            }
            datos.horasTrabajadas = Math.round((datos.horasTrabajadas + horas) * 10) / 10;
            datos.historial[registroId] = {
                fecha: new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                horas,
                timestamp: new Date(fecha + 'T12:00:00').getTime(),
                horaInicio,
                horaFin
            };
            await this._writeDriveFile(datos);
            localStorage.setItem('lastRegisteredDate', registroId);
            window.AndroidBridge?.saveToPrefs('lastRegisteredDate', registroId);
            this._detenerGeofencingNativo();
            this._cancelarNotificacionTrabajo();
            this.actualizarUI(datos);
            this._mostrarToast(`✅ ${horas}h registradas (${horaInicio}–${horaFin})`, 4000);
            this._publicarResumen();
        } catch(e) {
            this._mostrarToast('❌ Error al registrar: ' + e.message, 4000);
        }
    },

    async probarNotificacion() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                await LN.requestPermissions();
                const notif = {
                    id: 9999,
                    title: '🔔 EMT - Movilidad — prueba',
                    body: 'Las notificaciones funcionan correctamente.',
                };
                if (this.notifSound && this.notifSound !== 'default') {
                    notif.sound = this.notifSound;
                    notif.channelId = this.notifSound;
                }
                await LN.schedule({ notifications: [notif] });
            } catch(e) {
                alert('❌ Error al enviar notificación: ' + e.message);
            }
            return;
        }
        if (!('Notification' in window)) { alert('❌ Tu navegador no soporta notificaciones'); return; }
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') { alert('❌ Permiso de notificación denegado'); return; }
        }
        if (Notification.permission === 'denied') { alert('❌ Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.'); return; }
        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification('🔔 EMT - Movilidad — prueba', {
                body: 'Las notificaciones funcionan correctamente.',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'test-notif'
            });
        } catch(_) {
            new Notification('🔔 EMT - Movilidad — prueba', { body: 'Las notificaciones funcionan correctamente.', icon: '/icons/icon-192.png' });
        }
    },

    _getPreferencias() {
        return {
            darkMode: this.darkMode,
            tema: this.tema,
            avatarEmoji: localStorage.getItem('avatarEmoji') || null,
            avatarBg: localStorage.getItem('avatarBg') || null,
            avatarPhoto: localStorage.getItem('avatarPhoto') || null,
            gpsMode: this.gpsMode,
            gpsInterval: this.gpsInterval,
            gpsScheduleFrom: this.gpsScheduleFrom,
            gpsScheduleTo: this.gpsScheduleTo,
            precioNocheDefault: this.precioNocheDefault,
            precioExtraDefault: this.precioExtraDefault,
            precioFestivoDefault: this.precioFestivoDefault,
            fechaAltaDefault: this.fechaAltaDefault,
            pctBieniosDefault: this.pctBieniosDefault,
            horasAnualesCustom: this.horasAnualesCustom,
            jornadaHoras: this.jornadaHoras,
            diasSemana: this.diasSemana || null,
            numConductor: this.numConductor,
            backupFreq: this.backupFreq,
            vacaciones: this._getVacaciones(),
            workLocations: this._getWorkLocations(),
            notifSound: this.notifSound,
            notifSoundChat: this.notifSoundChat
        };
    },

    _aplicarPreferenciasDesde(prefs) {
        if (prefs.darkMode !== undefined && prefs.darkMode !== this.darkMode) {
            this.darkMode = prefs.darkMode;
            localStorage.setItem('darkMode', String(prefs.darkMode));
            prefs.darkMode ? this.aplicarDarkMode() : this.removerDarkMode();
            const toggle = document.getElementById('darkModeToggle');
            if (toggle) toggle.checked = this.darkMode;
        }
        if (prefs.tema && prefs.tema !== this.tema) {
            this.tema = prefs.tema;
            localStorage.setItem('tema', prefs.tema);
            this.aplicarTema(prefs.tema);
        }
        if (prefs.avatarPhoto) {
            localStorage.setItem('avatarPhoto', prefs.avatarPhoto);
            localStorage.removeItem('avatarEmoji');
        } else if (prefs.avatarEmoji) {
            localStorage.setItem('avatarEmoji', prefs.avatarEmoji);
            if (prefs.avatarBg) localStorage.setItem('avatarBg', prefs.avatarBg);
            localStorage.removeItem('avatarPhoto');
        }
        if (prefs.gpsMode) { this.gpsMode = prefs.gpsMode; localStorage.setItem('gpsMode', prefs.gpsMode); }
        if (prefs.gpsInterval) { this.gpsInterval = prefs.gpsInterval; localStorage.setItem('gpsInterval', String(prefs.gpsInterval)); }
        if (prefs.gpsScheduleFrom) { this.gpsScheduleFrom = prefs.gpsScheduleFrom; localStorage.setItem('gpsScheduleFrom', prefs.gpsScheduleFrom); }
        if (prefs.gpsScheduleTo) { this.gpsScheduleTo = prefs.gpsScheduleTo; localStorage.setItem('gpsScheduleTo', prefs.gpsScheduleTo); }
        if (prefs.precioNocheDefault !== undefined && prefs.precioNocheDefault !== null) {
            this.precioNocheDefault = prefs.precioNocheDefault;
            localStorage.setItem('precioNoche', String(prefs.precioNocheDefault));
            const el = document.getElementById('precioNocheGlobal');
            if (el) el.value = prefs.precioNocheDefault;
        }
        if (prefs.precioFestivoDefault !== undefined && prefs.precioFestivoDefault !== null) {
            this.precioFestivoDefault = prefs.precioFestivoDefault;
            localStorage.setItem('precioFestivo', String(prefs.precioFestivoDefault));
            const el = document.getElementById('precioFestivoGlobal');
            if (el) el.value = prefs.precioFestivoDefault;
        }
        if (prefs.precioExtraDefault !== undefined && prefs.precioExtraDefault !== null) {
            this.precioExtraDefault = prefs.precioExtraDefault;
            localStorage.setItem('precioExtra', String(prefs.precioExtraDefault));
            const el = document.getElementById('precioExtraGlobal');
            if (el) el.value = prefs.precioExtraDefault;
        }
        if (prefs.fechaAltaDefault !== undefined && prefs.fechaAltaDefault !== null) {
            this.fechaAltaDefault = prefs.fechaAltaDefault;
            localStorage.setItem('fechaAlta', prefs.fechaAltaDefault);
            const el = document.getElementById('fechaAltaGlobal');
            if (el) el.value = prefs.fechaAltaDefault;
        }
        if (prefs.pctBieniosDefault !== undefined && prefs.pctBieniosDefault !== null) {
            this.pctBieniosDefault = prefs.pctBieniosDefault;
            localStorage.setItem('pctBieniosManual', String(prefs.pctBieniosDefault));
            const el = document.getElementById('pctBieniosGlobal');
            if (el) el.value = prefs.pctBieniosDefault;
        }
        if (Array.isArray(prefs.vacaciones)) {
            localStorage.setItem('vacaciones', JSON.stringify(prefs.vacaciones));
            this._aplicarModoVacaciones();
        }
        if (prefs.backupFreq) {
            this.backupFreq = prefs.backupFreq;
            localStorage.setItem('backupFreq', prefs.backupFreq);
        }
        if (typeof prefs.numConductor === 'string') {
            this.numConductor = prefs.numConductor;
            localStorage.setItem('numConductor', prefs.numConductor);
            this._actualizarCabeceraUsuario();
        }
        if (prefs.jornadaHoras) {
            this.jornadaHoras = prefs.jornadaHoras;
            localStorage.setItem('jornadaHoras', String(prefs.jornadaHoras));
        }
        // Los días de la media jornada viajaban solo en localStorage: al
        // reinstalar se perdían aunque el resto de ajustes volviera.
        if (Array.isArray(prefs.diasSemana)) {
            this.diasSemana = prefs.diasSemana;
            localStorage.setItem('diasSemana', JSON.stringify(prefs.diasSemana));
        } else if (prefs.diasSemana === null) {
            this.diasSemana = null;
            localStorage.removeItem('diasSemana');
        }
        if (prefs.horasAnualesCustom) {
            this.horasAnualesCustom = prefs.horasAnualesCustom;
            localStorage.setItem('horasAnuales', String(prefs.horasAnualesCustom));
        }
        if (Array.isArray(prefs.workLocations) && prefs.workLocations.length > 0) {
            this._saveWorkLocations(prefs.workLocations);
        }
        if (prefs.notifSound) {
            this.notifSound = prefs.notifSound;
            localStorage.setItem('notifSound', prefs.notifSound);
        }
        this.actualizarBotonesPerfil();
    },

    _mostrarToast(msg, duration = 3000, onClick = null) {
        let toast = document.getElementById('appToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'appToast';
            toast.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:rgba(21,101,192,0.95);color:#fff;padding:11px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:9999;max-width:85vw;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.25);cursor:pointer;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.display = 'block';
        toast.style.opacity = '1';
        toast.onclick = onClick || null;
        clearTimeout(this._toastTimer);
        if (duration > 0) {
            this._toastTimer = setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => { toast.style.display = 'none'; }, 300); }, duration);
        }
    },

    async _notificarBackup(titulo, cuerpo) {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) {
            try {
                await LN.schedule({ notifications: [{ id: 2001, title: titulo, body: cuerpo }] });
                return;
            } catch(e) {}
        }
        this._mostrarToast('✅ ' + cuerpo, 4000);
    },

    _updateGpsState() {
        const locs = this._getWorkLocations();
        if (window.AndroidBridge?.registerGeofences) {
            if (locs.length === 0 || this.gpsMode === 'off') {
                window.AndroidBridge.removeGeofences();
            } else {
                if (window.AndroidBridge.hasBackgroundLocationPermission?.() === false) {
                    window.AndroidBridge.requestLocationPermissions?.();
                }
                window.AndroidBridge.registerGeofences(JSON.stringify(locs));
            }
            return;
        }
        if (locs.length === 0 || this.gpsMode === 'off') { this._detenerGeofencingNativo(); return; }
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) { this._detenerGeofencingNativo(); return; }
        if (!this._bgGeoStarted) this._iniciarGeofencingNativo();
    },

    _isInGpsSchedule() {
        const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
        const cur = new Date().getHours() * 60 + new Date().getMinutes();
        const from = toMin(this.gpsScheduleFrom);
        const to = toMin(this.gpsScheduleTo);
        return from <= to ? (cur >= from && cur <= to) : (cur >= from || cur <= to);
    },

    _startScheduleTimer() {
        clearInterval(this._scheduleTimer);
        this._scheduleTimer = setInterval(() => this._updateGpsState(), 5 * 60 * 1000);
    },

    guardarGpsConfig() {
        const mode = document.querySelector('input[name="gpsMode"]:checked')?.value || 'always';
        const aviso = document.querySelector('input[name="avisoLugar"]:checked')?.value || 'cada';
        this.avisoLugar = aviso;
        localStorage.setItem('avisoLugar', aviso);
        const interval = parseInt(document.getElementById('gpsIntervalSelect')?.value || '60');
        const from = document.getElementById('gpsFrom')?.value || '07:00';
        const to = document.getElementById('gpsTo')?.value || '09:00';
        this.gpsMode = mode; this.gpsInterval = interval;
        this.gpsScheduleFrom = from; this.gpsScheduleTo = to;
        localStorage.setItem('gpsMode', mode);
        localStorage.setItem('gpsInterval', String(interval));
        localStorage.setItem('gpsScheduleFrom', from);
        localStorage.setItem('gpsScheduleTo', to);
        window.AndroidBridge?.saveToPrefs('gpsMode', mode);
        this._publicarLugaresHoy();
        window.AndroidBridge?.saveToPrefs('gpsScheduleFrom', from);
        window.AndroidBridge?.saveToPrefs('gpsScheduleTo', to);
        this._renderGpsSettings();
        this._updateGpsState();
        this._guardarPreferencias();
    },

    _renderGpsSettings() {
        const av = document.querySelector(`input[name="avisoLugar"][value="${this.avisoLugar}"]`);
        if (av) av.checked = true;
        const radio = document.querySelector(`input[name="gpsMode"][value="${this.gpsMode}"]`);
        if (radio) radio.checked = true;
        const sel = document.getElementById('gpsIntervalSelect');
        if (sel) sel.value = String(this.gpsInterval);
        const fromEl = document.getElementById('gpsFrom');
        if (fromEl) fromEl.value = this.gpsScheduleFrom;
        const toEl = document.getElementById('gpsTo');
        if (toEl) toEl.value = this.gpsScheduleTo;
        const chatSel = document.getElementById('notifSoundChat');
        if (chatSel) chatSel.value = this.notifSoundChat;
        this._pintarCampana();
        const soundSel = document.getElementById('notifSoundSelect');
        if (soundSel) soundSel.value = this.notifSound;
        const intervalRow = document.getElementById('gpsIntervalRow');
        const scheduleRow = document.getElementById('gpsScheduleRow');
        if (intervalRow) intervalRow.style.display = this.gpsMode === 'off' ? 'none' : '';
        if (scheduleRow) scheduleRow.style.display = this.gpsMode === 'schedule' ? '' : 'none';
    },

    // inmediato=true guarda ya y devuelve la promesa, para poder esperar a que
    // esté en Drive antes de releer (si no, la recarga trae el valor viejo y
    // pisa el que se acaba de cambiar).
    _guardarPreferencias(inmediato = false) {
        clearTimeout(this._prefSaveTimer);
        const guardar = async () => {
            if (!this.usuarioActual) return;
            try {
                const data = await this._readDriveFile() || { horasTrabajadas: 0, historial: {} };
                const hi = localStorage.getItem('lastHoraInicio');
                const hf = localStorage.getItem('lastHoraFin');
                if (hi && hf) {
                    if (!data.prefs) data.prefs = {};
                    data.prefs.horaInicio = hi;
                    data.prefs.horaFin = hf;
                }
                await this._writeDriveFile(data);
            } catch(e) { console.error('Error guardando preferencias:', e); }
            // Cambios como el número de trabajador o el avatar pasan por aquí.
            // _publicarResumen solo escribe si algo del resumen cambió de verdad,
            // así que engancharlo aquí cubre todos los casos sin duplicar avisos.
            this._publicarResumen();
        };
        if (inmediato) return guardar();
        this._prefSaveTimer = setTimeout(guardar, 2000);
        return Promise.resolve();
    },

    // Acepta coma o punto: en el teclado español "3,5" se escribe con coma y
    // parseFloat('3,5') daría 3.
    _leerDecimal(v) {
        const n = parseFloat(String(v).replace(',', '.').trim());
        return isNaN(n) ? null : n;
    },

    async _pedirPermisosIniciales() {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (LN) { try { await LN.requestPermissions(); } catch(_) {} }
        this._crearCanalesNotificacion();
        if (window.AndroidBridge?.requestLocationPermissions) {
            window.AndroidBridge.requestLocationPermissions();
        } else {
            const Geo = window.Capacitor?.Plugins?.Geolocation;
            if (Geo) { try { await Geo.requestPermissions({ permissions: ['location', 'coarseLocation'] }); } catch(_) {} }
        }
    },

    _crearCanalesNotificacion() {
        const LN = window.Capacitor?.Plugins?.LocalNotifications;
        if (!LN?.createChannel) return;
        const channels = [
            { id: 'notif_ding',    name: 'Ding',        sound: 'notif_ding' },
            { id: 'notif_campana', name: 'Campana',      sound: 'notif_campana' },
            { id: 'notif_alerta',  name: 'Alerta',       sound: 'notif_alerta' },
            { id: 'notif_silbido', name: 'Silbido',      sound: 'notif_silbido' },
            { id: 'notif_doble',   name: 'Doble pitido', sound: 'notif_doble' },
            { id: 'notif_fanfare', name: 'Fanfare',      sound: 'notif_fanfare' },
            { id: 'notif_suave',   name: 'Suave',        sound: 'notif_suave' },
        ];
        channels.forEach(ch => {
            LN.createChannel({ ...ch, importance: 5, visibility: 1 }).catch(() => {});
        });
    },

    calcularDistancia(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    registrarJornadaHoy() {
        document.getElementById('workBanner').classList.remove('show');
        this._detenerGeofencingNativo();
        this._cancelarNotificacionTrabajo();
        const horaInicio = localStorage.getItem('lastHoraInicio');
        const horaFin    = localStorage.getItem('lastHoraFin');
        if (horaInicio && horaFin && this.usuarioActual) {
            this._registrarDesdeNotificacion();
        } else {
            this.establecerFechaHoy();
            this.mostrarApp();
            document.getElementById('horasInput').focus();
        }
    },

    // ── CONTROL DE ACCESO ──────────────────────────────────────────────────────

    async _checkUserAuthorized(email) {
        if (email.toLowerCase() === SUPER_USER_EMAIL.toLowerCase()) return true;
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) return true;
            const allowed = await resp.json();
            if (!Array.isArray(allowed) || allowed.length === 0) return true;
            return allowed.map(e => e.toLowerCase()).includes(email.toLowerCase());
        } catch(e) { return true; }
    },

    async _cargarUsuariosAcceso() {
        const el = document.getElementById('allowedUsersList');
        if (!el) return;
        el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">Cargando...</div>';
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) throw new Error(resp.status);
            this._allowedUsersLocal = await resp.json();
            this._renderAllowedUsers();
        } catch(e) {
            el.innerHTML = '<div style="color:#e74c3c;font-size:12px;">Error al cargar lista</div>';
        }
    },

    _renderAllowedUsers() {
        const el = document.getElementById('allowedUsersList');
        if (!el) return;
        const emails = this._allowedUsersLocal || [];
        if (emails.length === 0) {
            el.innerHTML = '<div style="color:#888;font-size:12px;padding:4px 0;">Lista vacía — cualquier cuenta puede entrar</div>';
            return;
        }
        el.innerHTML = emails.map(email =>
            `<div class="access-user-item">
                <span class="access-user-email">${email}</span>
                <button class="access-user-remove" onclick="app._removeUserAcceso('${email.replace(/'/g,"\\'")}\')" title="Eliminar">✕</button>
            </div>`
        ).join('');
    },

    async _addUserAcceso() {
        const input = document.getElementById('newUserEmail');
        const email = (input?.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) { this._mostrarToast('❌ Introduce un correo válido'); return; }
        const btn = document.querySelector('#sectionAcceso .ops-body button[onclick*="_addUserAcceso"]');
        if (btn) btn.disabled = true;
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, app: ALLOWLIST_APP })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status)); return; }
            this._allowedUsersLocal = data.emails;
            this._renderAllowedUsers();
            if (input) input.value = '';
            this._mostrarToast('✅ Usuario añadido');
        } catch(e) { this._mostrarToast('❌ Error: ' + e.message); }
        finally { if (btn) btn.disabled = false; }
    },

    async _removeUserAcceso(email) {
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, app: ALLOWLIST_APP })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status)); return; }
            this._allowedUsersLocal = data.emails;
            this._renderAllowedUsers();
            this._mostrarToast('Usuario eliminado');
        } catch(e) { this._mostrarToast('❌ Error: ' + e.message); }
    },

    // ────────────────────────────────────────────────────────────────────────────

    _buildNumToVersion(n) {
        return 'v' + Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
    },

    _actualizarVersionDisplay() {
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        const n = parseInt(String(APP_VERSION).replace('build-', '')) || 0;
        if (!n) return;
        const el = document.getElementById('versionDisplay');
        if (el) el.textContent = 'Versión ' + this._buildNumToVersion(n);
    },

    // GitHub permite 60 peticiones/hora sin autenticar y la app consulta en cada
    // apertura, así que se comparte una caché corta entre el chequeo de
    // actualizaciones y la lista de versiones para no agotarlas.
    async _releases(forzar) {
        const CACHE = 'releasesCache', EDAD = 'releasesCacheAt';
        if (!forzar) {
            const t = parseInt(sessionStorage.getItem(EDAD) || '0', 10);
            if (Date.now() - t < 5 * 60 * 1000) {
                try { return { ok: true, lista: JSON.parse(sessionStorage.getItem(CACHE) || '[]') }; }
                catch (_) {}
            }
        }
        const resp = await fetch('https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=100');
        if (!resp.ok) {
            // 403 aquí casi siempre es el límite por hora, no un permiso
            return { ok: false, status: resp.status, limite: resp.status === 403 };
        }
        const lista = await resp.json();
        try {
            sessionStorage.setItem(CACHE, JSON.stringify(lista));
            sessionStorage.setItem(EDAD, String(Date.now()));
        } catch (_) {}
        return { ok: true, lista };
    },

    // Qué build pueden instalar los trabajadores. Devuelve {ok:false} cuando no
    // se ha podido leer: en ese caso no se ofrece nada, porque antes un fallo de
    // red dejaba `publicada` a null y la app pasaba a ofrecer la más reciente,
    // saltándose el reparto escalonado justo cuando no había señal.
    async _buildPublicado() {
        try {
            const r = await fetch(VERSION_URL, { cache: 'no-store' });
            if (r.ok) {
                const build = (await r.json())?.build ?? null;
                localStorage.setItem('buildPublicado', JSON.stringify(build));
                return { ok: true, build };
            }
        } catch (_) { /* se intenta con lo último que se leyó */ }
        const guardado = localStorage.getItem('buildPublicado');
        if (guardado === null) return { ok: false };
        try { return { ok: true, build: JSON.parse(guardado) }; }
        catch (_) { return { ok: false }; }
    },

    async _checkForUpdates(showFeedback = false) {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        sessionStorage.setItem('lastUpdateCheck', String(Date.now()));
        try {
            // Both apps publish releases to the same repo, so pick only the ones
            // tagged for this app instead of whatever release is newest overall.
            const res = await this._releases(showFeedback);
            if (!res.ok) {
                if (showFeedback) this._mostrarToast(res.limite
                    ? '⏳ GitHub ha limitado las consultas. Prueba en unos minutos.'
                    : '❌ No se pudo comprobar (error ' + res.status + ')', 4500);
                return;
            }
            const lista = res.lista;
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            // El administrador recibe la última aunque no esté publicada, para
            // poder probarla antes de repartirla; al resto solo se les ofrece
            // la que el gestor haya publicado.
            const soyGestor = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
            let publicada = null;
            if (!soyGestor) {
                const pub = await this._buildPublicado();
                if (!pub.ok) {
                    if (showFeedback) this._mostrarToast(
                        '⏳ No se ha podido comprobar qué versión toca instalar. Prueba más tarde.', 4500);
                    return;
                }
                publicada = pub.build;
            }
            let release = null, latestNum = 0, latestTag = '';
            (Array.isArray(lista) ? lista : []).forEach(r => {
                const m = re.exec(r.tag_name || '');
                if (!m) return;
                const n = parseInt(m[1], 10);
                // Sin versión publicada se comporta como antes: la más reciente
                if (publicada !== null && n > publicada) return;
                if (n > latestNum) { latestNum = n; release = r; latestTag = r.tag_name; }
            });
            const currentNum = parseInt(String(APP_VERSION).replace('build-', '')) || 0;
            if (latestNum === 0) {
                // No hay ninguna versión aplicable: o no hay releases, o todas
                // son posteriores a la que el gestor ha publicado. En ninguno de
                // los dos casos hay nada que instalar, así que no es un error.
                if (showFeedback) this._mostrarToast('✅ Tienes instalada la última versión disponible');
                return;
            }
            if (latestNum > currentNum) {
                const asset = release.assets?.find(a => a.name.endsWith('.apk'));
                this._updateApkUrl = asset?.browser_download_url || release.html_url;
                const texto  = `${this._buildNumToVersion(latestNum)} disponible (tienes ${this._buildNumToVersion(currentNum)})`;
                const banner = document.getElementById('updateBanner');
                const msg    = document.getElementById('updateBannerMsg');
                if (msg) msg.textContent = texto;
                if (banner) banner.style.display = 'flex';
                // Auto-popup unless snoozed. "Más tarde" only postpones it for a
                // few hours — never permanently, or a single dismissal would
                // strand the user on an old build.
                this._updateLatestNum = latestNum;
                const modal    = document.getElementById('updateModal');
                const modalMsg = document.getElementById('updateModalMsg');
                const snooze   = parseInt(localStorage.getItem('updateSnooze_' + latestNum) || '0', 10);
                if (modal && (showFeedback || Date.now() >= snooze)) {
                    if (modalMsg) modalMsg.textContent = texto;
                    modal.style.display = 'flex';
                }
            } else if (showFeedback) {
                // Tener una versión posterior a la publicada tampoco es un
                // problema: simplemente no hay actualización que ofrecer.
                this._mostrarToast('✅ Tienes instalada la última versión disponible ('
                    + this._buildNumToVersion(currentNum) + ')');
            }
        } catch(_) {
            if (showFeedback) this._mostrarToast('❌ No se pudo comprobar la versión');
        }
    },

    _posponerActualizacion() {
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
        if (this._updateLatestNum) {
            localStorage.setItem('updateSnooze_' + this._updateLatestNum,
                String(Date.now() + 8 * 60 * 60 * 1000));
        }
    },

    _descargarActualizacion() {
        const url = this._updateApkUrl;
        if (!url) return;
        const modal = document.getElementById('updateModal');
        if (modal) modal.style.display = 'none';
        const overlay = document.getElementById('updateProgressOverlay');
        if (overlay) overlay.style.display = 'flex';
        const bar = document.getElementById('updateProgressBar');
        const pct = document.getElementById('updateProgressPct');
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (bar) bar.style.width = '0%';
        if (pct) pct.textContent = '0%';
        if (txt) txt.textContent = 'Descargando nueva versión...';
        if (closeBtn) closeBtn.style.display = 'none';
        if (window.AndroidBridge?.downloadAndInstallApk) {
            window.AndroidBridge.downloadAndInstallApk(url);
        } else {
            if (overlay) overlay.style.display = 'none';
            window.open(url, '_system');
        }
    },

    _onUpdateProgress(pct) {
        const bar = document.getElementById('updateProgressBar');
        const pctEl = document.getElementById('updateProgressPct');
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (pct >= 100) {
            if (txt) txt.textContent = 'Instalando... el sistema pedirá confirmación.';
            if (closeBtn) closeBtn.style.display = 'inline-block';
        }
    },

    _onUpdateError() {
        const txt = document.getElementById('updateProgressTxt');
        const closeBtn = document.getElementById('updateProgressClose');
        if (txt) txt.textContent = 'Error al descargar. Inténtalo de nuevo.';
        if (closeBtn) closeBtn.style.display = 'inline-block';
    },

    _mostrarExportTexto(json) {
        const uid = 'exp-' + Date.now();
        const overlay = document.createElement('div');
        overlay.id = uid + '-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
        overlay.innerHTML = `
            <div style="background:var(--card);border-radius:16px;padding:20px;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;gap:12px">
                <div style="font-weight:700;font-size:16px">Copia de seguridad</div>
                <div style="font-size:12px;color:var(--text-secondary)">Copia este texto y guárdalo en un archivo .json</div>
                <textarea id="${uid}" readonly style="flex:1;min-height:200px;font-family:monospace;font-size:11px;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--bg);resize:none"></textarea>
                <div style="display:flex;gap:8px">
                    <button id="${uid}-copy" style="flex:1;padding:10px;border-radius:8px;background:var(--primary);color:#fff;border:none;cursor:pointer">Copiar</button>
                    <button onclick="document.getElementById('${uid}-overlay').remove()" style="flex:1;padding:10px;border-radius:8px;background:var(--border);border:none;cursor:pointer">Cerrar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById(uid).value = json;
        document.getElementById(uid + '-copy').onclick = () => {
            navigator.clipboard.writeText(json).then(() => {
                document.getElementById(uid + '-copy').textContent = '✅ Copiado';
            });
        };
    }
};

app.init();

window._deferredPrompt = null;
const _isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const _isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function _showInstallBanner(ios) {
    if (_isStandalone) return;
    const banner = document.getElementById('installBanner');
    document.getElementById('installBannerMsg').textContent = ios ? 'Toca Compartir ↑ → "Añadir a inicio"' : 'Instala la app para acceso rápido';
    const bannerBtn = document.getElementById('installBannerBtn');
    if (bannerBtn) bannerBtn.style.display = ios ? 'none' : '';
    if (banner) banner.classList.add('show');
    const sec = document.getElementById('installSection');
    if (sec) sec.style.display = '';
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window._deferredPrompt = e; _showInstallBanner(false); });
window.addEventListener('appinstalled', () => {
    window._deferredPrompt = null;
    const banner = document.getElementById('installBanner'); if (banner) banner.classList.remove('show');
    const sec = document.getElementById('installSection'); if (sec) sec.style.display = 'none';
});

app.instalarApp = async function() {
    if (!window._deferredPrompt) { alert(_isIOS ? 'En Safari:\n1. Toca Compartir (□↑)\n2. "Añadir a pantalla de inicio"\n3. Pulsa "Añadir"' : 'Usa el menú del navegador → "Instalar app".'); return; }
    window._deferredPrompt.prompt();
    const { outcome } = await window._deferredPrompt.userChoice;
    if (outcome === 'accepted') { const banner = document.getElementById('installBanner'); if (banner) banner.classList.remove('show'); const sec = document.getElementById('installSection'); if (sec) sec.style.display = 'none'; }
    window._deferredPrompt = null;
};
app.ocultarInstallBanner = function() { const b = document.getElementById('installBanner'); if (b) b.classList.remove('show'); };

if (_isIOS && !_isStandalone) setTimeout(() => _showInstallBanner(true), 3000);
