(function(){var t=localStorage.getItem('tema');if(t&&t!=='azul')document.body.classList.add('theme-'+t);})();
'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
// drive.file is needed on top of appdata: appdata can only write to a hidden
// folder, so the monthly export could not create a visible "Movilidad Emt".
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file profile email';
const AUTH_SCOPE       = 'profile email';
const SUPER_USER_EMAIL = 'g.rioscorrea@gmail.com';
const ALLOWLIST_APP    = 'gestion';
const VERSION_URL      = 'https://registro-horario-emt.vercel.app/api/version';
const ANDROID_PACKAGE  = 'com.guillermorc.gestionemt';
const RELEASE_PREFIX   = 'gestion-build-';
const DRIVE_FILE_NAME  = 'gestion-emt-movilidad.json';
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
    modalCallback: null,
    editingId: null,
    prActivo: false,
    festivoActivo: false,
    extraActivo: false,
    vacacionesActivo: false,
    jornadaHoras: parseFloat(localStorage.getItem('jornadaHoras')) || 7.5,
    numConductor: localStorage.getItem('numConductor') || '',
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
        // The update check must run even if any earlier step throws, otherwise a
        // single bug anywhere above strands the user on an old build forever.
        setTimeout(() => { try { this._checkForUpdates(); } catch(_) {} }, 1500);
        this._migrarUbicacionAntigua();
        this.setupUI();
        if (this.darkMode) this.aplicarDarkMode();
        this._restaurarTabs();
        this._initSwipeTabs();
        this._restaurarMensual();
        this._restaurarSecciones();
        this._cargarCuadrante();
        this._aplicarModoVacaciones();
        this._buildAvatarGrid();
        this._setupDeepLinkListener();
        this._setupAppLifecycleBackup();
        this._setupNotificationActions(); // must register listener before any async
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
                if (document.getElementById('historialModal')?.classList.contains('show')) {
                    document.getElementById('historialModal').classList.remove('show');
                } else if (document.getElementById('editModal')?.classList.contains('show')) {
                    document.getElementById('editModal').classList.remove('show');
                } else if (document.getElementById('avatarModal')?.classList.contains('show')) {
                    document.getElementById('avatarModal')?.classList.remove('show');
                } else if (document.getElementById('optionsScreen')?.classList.contains('active')) {
                    this.mostrarApp();
                } else {
                    window.Capacitor.Plugins.App?.minimizeApp?.();
                }
            });
        } catch (_) {}
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
            if (this.backupFreq !== 'cerrar') return;
            if (this.accessToken && Date.now() < this.tokenExpiry) this._autoBackup();
        };
        const onForeground = () => {
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
        if (!document.getElementById('horaInicio')) return;
        const inicio = localStorage.getItem('lastHoraInicio');
        const fin    = localStorage.getItem('lastHoraFin');
        if (inicio) document.getElementById('horaInicio').value = inicio;
        if (fin)    document.getElementById('horaFin').value    = fin;
        if (inicio && fin) this.calcularHorasPorTiempo();
    },

    setupUI() {
        this.establecerFechaHoy();
        this.actualizarFecha();
        if (this.precioNocheDefault > 0) {
            { const e = document.getElementById('precioNocheGlobal'); if (e) e.value = this.precioNocheDefault; }
        }
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

    async _getDriveFileId() {
        if (this.driveFileId) return this.driveFileId;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D'${DRIVE_FILE_NAME}'&fields=files(id)`
        );
        const data = await resp.json();
        if (data.files && data.files.length > 0) {
            this.driveFileId = data.files[0].id;
            localStorage.setItem('driveFileId', this.driveFileId);
            window.AndroidBridge?.saveToPrefs('driveFileId', this.driveFileId);
        }
        return this.driveFileId;
    },

    async _readDriveFile() {
        const fileId = await this._getDriveFileId();
        if (!fileId) return null;
        const resp = await this._driveGet(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
        );
        if (!resp.ok) return null;
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
            this._renderGpsSettings();
            this._startScheduleTimer();
            this.verificarUbicacion();
            this._updateGpsState();
            this._cargarConductores();
            this._pedirPermisosIniciales();
            if (this._pendingNotifAction === 'registro-rapido') {
                this._pendingNotifAction = null;
                this._registrarDesdeNotificacion();
            }
        } catch(e) {
            console.error('Error cargando datos:', e);
            this.actualizarUI({ horasTrabajadas: 0, historial: {} });
        }
    },

    async registrarHoras() {
        if (!this.usuarioActual) { alert('❌ No hay sesión activa'); return; }
        const horasRaw = document.getElementById('horasInput').value;
        const horas = parseFloat(horasRaw) || 0;
        const fecha = document.getElementById('fechaInput').value;
        const esFestivo      = this.festivoActivo;
        const esVacaciones   = this.vacacionesActivo;
        // A holiday or a vacation day may be registered with no hours worked;
        // anything else needs hours.
        if (!fecha || (!esFestivo && !esVacaciones && (isNaN(parseFloat(horasRaw)) || horas <= 0))) {
            alert('❌ Introduce fecha y horas válidas'); return;
        }
        if (horas < 0) { alert('❌ Las horas no pueden ser negativas'); return; }
        const horaInicio     = document.getElementById('horaInicio').value;
        const horaFin        = document.getElementById('horaFin').value;
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

            if (this.editingId && datos.historial[this.editingId]) {
                delete datos.historial[this.editingId];
            }
            const fechaFormato = new Date(fecha + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const fechaKey     = fecha.replace(/-/g, '');
            const registroId   = this.editingId || this._nuevoRegistroId(datos.historial, fechaKey);
            datos.historial[registroId] = {
                fecha: fechaFormato, horas,
                timestamp: new Date(fecha + 'T12:00:00').getTime(),
                ...(horaInicio && horaFin ? { horaInicio, horaFin } : {}),
                ...(esNoche && horasNocturnas > 0 ? { horasNocturnas, precioNoche, extraNoche } : {}),
                ...(esPR ? { pr: true } : {}),
                ...(esFestivo ? { festivo: true } : {}),
                ...(esExtra ? { extraManual: true, extraDestino } : {}),
                ...(esVacaciones ? { vacaciones: true } : {})
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
            try { await navigator.share({ title: 'Copia Gestión EMT Movilidad', files: [file] }); this._mostrarToast('✅ Copia exportada', 3000); return; }
            catch(e) { if (e.name === 'AbortError') return; }
        }
        if (navigator.share) {
            try { await navigator.share({ title: 'Copia Gestión EMT Movilidad', text: json }); this._mostrarToast('✅ Copia exportada', 3000); return; }
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
        if (!document.getElementById('fechaInput')) return;
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

    mostrarOpciones() {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('appScreen').classList.remove('active');
        document.getElementById('optionsScreen').classList.add('active');
        document.getElementById('darkModeToggle').checked = this.darkMode;
        { const e = document.getElementById('horasAnualesDisplay'); if (e) e.textContent = this.horasAnualesCustom + 'h'; }
        this._actualizarJornadaDisplay();
        this._actualizarConductorDisplay();
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
        if (!document.getElementById('horaInicio')) return;
        const inicio = document.getElementById('horaInicio').value;
        const fin    = document.getElementById('horaFin').value;
        if (!inicio || !fin) return;
        const [h1, m1] = inicio.split(':').map(Number);
        const [h2, m2] = fin.split(':').map(Number);
        let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (mins < 0) mins += 1440;
        const horas = Math.round(mins / 60 * 2) / 2;
        if (horas > 0) document.getElementById('horasInput').value = horas;
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
        if (!document.getElementById('prCompact')) return;
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
    },

    // ── Vacaciones ───────────────────────────────────────────────────────────

    _getVacaciones() { return JSON.parse(localStorage.getItem('vacaciones') || '[]'); },

    _saveVacaciones(v) {
        localStorage.setItem('vacaciones', JSON.stringify(v));
        this._guardarPreferencias();
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
        const desde = document.getElementById('vacDesde')?.value;
        const hasta = document.getElementById('vacHasta')?.value;
        if (!desde || !hasta) { this._mostrarToast('❌ Indica las dos fechas', 3000); return; }
        if (hasta < desde)    { this._mostrarToast('❌ La fecha final es anterior a la inicial', 3000); return; }
        const v = this._getVacaciones();
        v.push({ desde, hasta });
        v.sort((a, b) => a.desde.localeCompare(b.desde));
        this._saveVacaciones(v);
        { const e = document.getElementById('vacDesde'); if (e) e.value = ''; }
        { const e = document.getElementById('vacHasta'); if (e) e.value = ''; }
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

    async mostrarCambiarJornada() {
        const v = prompt('¿Cuántas horas tiene tu jornada?\n\nPuedes usar decimales: 3,5 o 3.5\nSe usará para contar los festivos que no trabajas.', this.jornadaHoras);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.\nEjemplo: 3,5 o 7'); return; }
        this.jornadaHoras = n;
        localStorage.setItem('jornadaHoras', String(n));
        this._actualizarJornadaDisplay();
        await this._guardarPreferencias(true);
        this.cargarDatos();
        this._mostrarToast(`✅ Jornada: ${n}h`, 2500);
    },

    _actualizarJornadaDisplay() {
        const el = document.getElementById('jornadaHorasDisplay');
        if (el) el.textContent = this.jornadaHoras + 'h';
    },

    mostrarCambiarConductor() {
        const v = prompt('Número de trabajador (5 dígitos).\n\nPuedes escribirlo con o sin guión: 14183 o 1418-3', this.numConductor || '');
        if (v === null) return;
        // Accept it typed either way and always store it as 1418-3
        const digitos = v.replace(/\D/g, '');
        if (v.trim() && digitos.length !== 5) {
            alert('❌ Formato incorrecto. Deben ser 5 dígitos.\nEjemplo: 14183 o 1418-3');
            return;
        }
        const val = digitos ? digitos.slice(0, 4) + '-' + digitos.slice(4) : '';
        this.numConductor = val;
        localStorage.setItem('numConductor', val);
        this._actualizarConductorDisplay();
        this._actualizarCabeceraUsuario();
        this._guardarPreferencias();
    },

    _actualizarConductorDisplay() {
        const el = document.getElementById('conductorDisplay');
        if (el) el.textContent = this.numConductor || 'Sin asignar';
    },

    _actualizarCabeceraUsuario() {
        const nom = document.getElementById('cabeceraNombre');
        const num = document.getElementById('cabeceraNum');
        if (nom) nom.textContent = this.usuarioActual?.name || '';
        if (num) num.textContent = this.numConductor || '';
    },

    // Record ids are YYYYMMDD for the first entry of a day, then YYYYMMDD-2, -3…
    _nuevoRegistroId(historial, fechaKey) {
        if (!historial[fechaKey]) return fechaKey;
        let n = 2;
        while (historial[`${fechaKey}-${n}`]) n++;
        return `${fechaKey}-${n}`;
    },

    _fechaDeId(id) { return String(id).slice(0, 8); },

    _hayRegistroEnFecha(fechaKey) {
        return Object.keys(this._historialFull || {}).some(id => this._fechaDeId(id) === fechaKey);
    },

    // Single source of truth for all hour totals, derived from the history
    _calcTotales(historial) {
        let anual = 0, extrasManual = 0, festivo = 0, diasFestivos = 0;
        Object.values(historial || {}).forEach(r => {
            const h = parseFloat(r.horas) || 0;
            if (r.extraDestino === 'extras') { extrasManual += h; return; }
            // A holiday you did not work still counts as a full standard shift
            const efectivas = (r.festivo && h === 0) ? this.jornadaHoras : h;
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
        if (!document.getElementById('fechaInput')) return;
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
    _initSwipeTabs() {
        const cont = document.getElementById('appContent');
        if (!cont) return;
        let x0 = 0, y0 = 0, activo = false;
        cont.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) { activo = false; return; }
            const t = e.touches[0];
            x0 = t.clientX; y0 = t.clientY; activo = true;
        }, { passive: true });
        cont.addEventListener('touchend', e => {
            if (!activo) return;
            activo = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - x0, dy = t.clientY - y0;
            // Debe ser claramente horizontal y suficientemente largo
            if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
            const orden = [...document.querySelectorAll('#tabBar .tab-btn')]
                .map(b => parseInt(b.dataset.tab, 10));
            const pos = orden.indexOf(this._activeTab);
            if (pos === -1) return;
            const destino = dx < 0 ? pos + 1 : pos - 1;
            if (destino < 0 || destino >= orden.length) return;
            this.switchTab(orden[destino]);
        }, { passive: true });
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
        if (idx === 0) this._cargarConductores();
        if (idx === 1) this._cargarCuadrante();
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
        if (!document.getElementById('fechaInput')) return;
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
                const cab = document.createElement('li');
                cab.className = 'hm-mes';
                cab.dataset.mes = mesKey;
                const colapsado = this._mesesColapsados.has(mesKey);
                cab.innerHTML = `<span class="hm-mes-chev">${colapsado ? '▸' : '▾'}</span>`
                    + `<span class="hm-mes-n">${MESES_ES[d.getMonth()]} ${d.getFullYear()}</span>`
                    + `<span class="hm-mes-tot">${(Math.round(totMes * 10) / 10).toFixed(1)}h`
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
            const prBadge     = reg.pr      ? `<span class="pr-badge">PR</span>` : '';
            const festivoBadge= reg.festivo ? `<span class="festivo-badge">🎉 Festivo</span>` : '';
            const vacBadge    = reg.vacaciones ? `<span class="vacaciones-badge">🏖️ Vacaciones</span>` : '';
            const extraBadge  = reg.extraManual
                ? `<span class="extra-badge">⏱️ ${reg.extraDestino === 'extras' ? 'Extra' : 'Anual'}</span>` : '';
            li.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="color:#7f8c8d;font-weight:700;font-size:12px;">${reg.fecha}</span>
                        ${horario}
                        <span style="background:linear-gradient(135deg,var(--g1),var(--g2));color:white;padding:3px 9px;border-radius:20px;font-weight:700;font-size:10px;">${reg.horas}h</span>
                        ${prBadge}${festivoBadge}${extraBadge}${vacBadge}
                    </div>
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
        Object.values(historial).forEach(reg => {
            if (!reg.timestamp) return;
            const d   = new Date(reg.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (!meses[key]) meses[key] = { horas:0, nocturnas:0, extra:0, dias:0, label:'', año:d.getFullYear(), mes:d.getMonth()+1 };
            meses[key].horas     = Math.round((meses[key].horas     + reg.horas) * 10) / 10;
            meses[key].nocturnas = Math.round((meses[key].nocturnas + (reg.horasNocturnas||0)) * 10) / 10;
            meses[key].extra     = Math.round((meses[key].extra     + (reg.extraNoche||0)) * 100) / 100;
            meses[key].dias++;
            meses[key].label = `${MESES_ES[d.getMonth()]} ${d.getFullYear()}`;
        });
        return meses;
    },

    actualizarUI(datos) {
        this._historialFull = datos.historial || {};
        this.actualizarHistorial(datos.historial || {});
        // En gestión no existen los cuadros de horas ni el formulario: sin esto
        // actualizarUI revienta al escribir en elementos que no están, y como el
        // catch de cargarDatos vuelve a llamarla, el arranque se queda colgado.
        if (!document.getElementById('horasTrabajadas')) return;
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
        if (elFS) elFS.textContent = t.diasFestivos === 1 ? '1 día festivo' : `${t.diasFestivos} días festivos`;
        if (elE)  elE.textContent  = t.extras.toFixed(1);
        if (elES) elES.textContent = `de ${t.topeExtras.toFixed(1)}h`;
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

    // Downscale before upload: a phone photo is several MB and the store caps
    // the payload, so send something the drivers can still read but that fits.
    subirCuadrante() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = async () => {
                    const MAX = 1400;
                    const escala = Math.min(1, MAX / Math.max(img.width, img.height));
                    const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    let calidad = 0.82, dataUrl = canvas.toDataURL('image/jpeg', calidad);
                    while (dataUrl.length > 680 * 1024 && calidad > 0.35) {
                        calidad -= 0.12;
                        dataUrl = canvas.toDataURL('image/jpeg', calidad);
                    }
                    if (dataUrl.length > 680 * 1024) {
                        this._mostrarToast('❌ La imagen sigue siendo muy grande', 4000);
                        return;
                    }
                    this._mostrarToast('📤 Subiendo cuadrante...', 2500);
                    try {
                        const resp = await fetch(this.CUADRANTE_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json',
                                       'X-Admin-Email': this.usuarioActual?.email || '' },
                            body: JSON.stringify({ imagen: dataUrl, nombre: file.name })
                        });
                        const data = await resp.json();
                        if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
                        this._pintarCuadrante(data);
                        localStorage.setItem('cuadranteCache', JSON.stringify(data));
                        this._mostrarToast('✅ Cuadrante publicado', 3000);
                    } catch (err) {
                        this._mostrarToast('❌ Error al subir: ' + err.message, 4000);
                    }
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    async borrarCuadrante() {
        if (!confirm('¿Quitar el cuadrante publicado?\nDejará de verse en la app de trabajadores.')) return;
        try {
            const resp = await fetch(this.CUADRANTE_URL, {
                method: 'DELETE',
                headers: { 'X-Admin-Email': this.usuarioActual?.email || '' }
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._pintarCuadrante(data);
            localStorage.removeItem('cuadranteCache');
            this._mostrarToast('Cuadrante retirado', 2500);
        } catch (err) { this._mostrarToast('❌ Error: ' + err.message, 4000); }
    },


    // ── Versión publicada a los trabajadores ──────────────────────────────────

    async _cargarVersiones() {
        const cont = document.getElementById('versionesList');
        const act  = document.getElementById('versionActual');
        if (!cont) return;
        cont.innerHTML = '<div class="ops-field-sub" style="padding:8px 14px;">Cargando…</div>';
        try {
            const [rRel, rVer] = await Promise.all([
                fetch('https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=30'),
                fetch(VERSION_URL, { cache: 'no-store' })
            ]);
            const releases = rRel.ok ? await rRel.json() : [];
            this._versionPublicada = rVer.ok ? ((await rVer.json())?.build ?? null) : null;
            // Solo las de la app de trabajadores
            const re = /^build-(\d+)$/;
            const builds = (Array.isArray(releases) ? releases : [])
                .map(r => ({ r, m: re.exec(r.tag_name || '') }))
                .filter(x => x.m)
                .map(x => ({ n: parseInt(x.m[1], 10), fecha: x.r.published_at }))
                .sort((a, b) => b.n - a.n);
            if (act) {
                act.textContent = this._versionPublicada === null
                    ? 'Ahora mismo reciben la más reciente'
                    : `Publicada: ${this._buildNumToVersion(this._versionPublicada)}`;
            }
            if (!builds.length) { cont.innerHTML = '<div class="ops-field-sub" style="padding:8px 14px;">Sin versiones</div>'; return; }
            cont.innerHTML = builds.map(b => {
                const activa = b.n === this._versionPublicada;
                const f = new Date(b.fecha).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
                return `<div class="ver-item${activa ? ' activa' : ''}">
                    <span class="ver-n">${this._buildNumToVersion(b.n)}<br><span class="ver-fecha">${f}</span></span>
                    ${activa ? '<span class="ver-badge">PUBLICADA</span>'
                             : `<button class="ver-btn" onclick="app._publicarVersion(${b.n})">Publicar</button>`}
                </div>`;
            }).join('');
        } catch (e) {
            cont.innerHTML = '<div style="color:#e74c3c;font-size:12px;padding:8px 14px;">Error al cargar versiones</div>';
        }
    },

    async _publicarVersion(build) {
        if (!confirm(`¿Publicar la ${this._buildNumToVersion(build)} para los trabajadores?\n\nSolo recibirán esa versión hasta que publiques otra.`)) return;
        try {
            const resp = await fetch(VERSION_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ build })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._mostrarToast('🚀 Publicada ' + this._buildNumToVersion(build), 3000);
            this._cargarVersiones();
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
    },


    // ── Trabajadores (gestión) ────────────────────────────────────────────────

    USUARIOS_URL: 'https://registro-horario-emt.vercel.app/api/usuarios',

    async _cargarConductores() {
        const cont = document.getElementById('condList');
        if (!cont) return;
        cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-s">Cargando…</span></div>';
        try {
            const resp = await fetch(this.USUARIOS_URL, { cache: 'no-store' });
            if (!resp.ok) throw new Error(resp.status);
            const data = await resp.json();
            this._conductores = data || {};
            this._renderConductores();
        } catch (e) {
            cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-ico">⚠️</span>'
                + '<span class="tab-empty-t">No se pudo cargar</span>'
                + '<span class="tab-empty-s">Revisa la conexión e inténtalo otra vez.</span></div>';
        }
    },


    // ── Puestos de trabajo: ¿queda cubierta la jornada? ──────────────────────

    _minutos(hhmm) {
        if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
        const [h, m] = hhmm.split(':').map(Number);
        return h * 60 + m;
    },

    // verde trabajando ahora, rojo ya terminado, gris aún sin empezar
    _estadoTurno(u) {
        if (u.horarioDe !== 'hoy') return { clase: 'gris', texto: 'sin registro hoy' };
        const ini = this._minutos(u.horaInicio), fin = this._minutos(u.horaFin);
        if (ini === null || fin === null) return { clase: 'gris', texto: 'sin horario' };
        const ahora = new Date().getHours() * 60 + new Date().getMinutes();
        let finReal = fin; if (finReal <= ini) finReal += 1440;   // turno que cruza medianoche
        let cur = ahora; if (cur < ini && finReal > 1440) cur += 1440;
        if (cur < ini) return { clase: 'gris',  texto: 'aún no ha entrado' };
        if (cur > finReal) return { clase: 'rojo', texto: 'ha terminado' };
        return { clase: 'verde', texto: 'trabajando' };
    },

    _renderPuestos() {
        const cont = document.getElementById('puestosList');
        if (!cont) return;
        const lista = Object.values(this._conductores || {});
        const conPuesto = lista.filter(u => (u.puesto || '').trim());
        if (!conPuesto.length) {
            cont.innerHTML = '<div class="tab-empty" style="padding:22px 16px;">'
                + '<span class="tab-empty-s">Asigna un puesto tocando el nombre de un trabajador<br>'
                + 'y aquí verás si queda cubierto.</span></div>';
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const porPuesto = {};
        conPuesto.forEach(u => { (porPuesto[u.puesto] = porPuesto[u.puesto] || []).push(u); });

        cont.innerHTML = Object.keys(porPuesto).sort().map(puesto => {
            // Ordenar por hora de entrada: así se ve de un vistazo si el relevo encaja
            const gente = porPuesto[puesto].sort((a, b) => {
                const ma = this._minutos(a.horaInicio), mb = this._minutos(b.horaInicio);
                if (ma === null) return 1;
                if (mb === null) return -1;
                return ma - mb;
            });
            const activos = gente.filter(u => this._estadoTurno(u).clase === 'verde').length;
            const filas = gente.map(u => {
                const e = this._estadoTurno(u);
                const horario = (u.horaInicio && u.horaFin) ? `${esc(u.horaInicio)}–${esc(u.horaFin)}` : 'sin horario';
                return `<div class="pst-fila">
                    <span class="pst-dot ${e.clase}" title="${esc(e.texto)}"></span>
                    <span class="pst-quien"><b>${esc(u.conductor) || '—'}</b> ${esc(u.nombre)}</span>
                    ${u.turno ? `<span class="cond-turno ${u.turno}">${u.turno}</span>` : ''}
                    <span class="pst-horario">${horario}</span>
                </div>`;
            }).join('');
            return `<div class="pst-card">
                <div class="pst-head">
                    <span class="pst-nombre">${esc(puesto)}</span>
                    <span class="pst-cob${activos > 0 ? '' : ' vacio'}">${activos > 0 ? `${activos} en turno` : 'sin cubrir'}</span>
                </div>
                ${filas}
            </div>`;
        }).join('');
    },

    _renderConductores() {
        const cont = document.getElementById('condList');
        const orden = localStorage.getItem('ordenTrabajadores') || 'nombre';
        const lista = Object.values(this._conductores || {}).sort((a, b) =>
            orden === 'numero'
                // Sin número al final, y comparación numérica para que 209 no
                // quede antes que 1418
                ? ((a.conductor || '\uffff').localeCompare(b.conductor || '\uffff', 'es', { numeric: true }))
                : (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        if (!lista.length) {
            cont.innerHTML = '<div class="tab-empty"><span class="tab-empty-ico">👥</span>'
                + '<span class="tab-empty-t">Sin trabajadores</span>'
                + '<span class="tab-empty-s">Aparecerán en cuanto abran su app.</span></div>';
            return;
        }
        const esc = t => String(t || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        cont.innerHTML = lista.map(u => {
            const ini = (u.nombre || u.email || '?').trim()[0]?.toUpperCase() || '?';
            const av = u.avatar
                ? `<img class="cond-avatar" src="${esc(u.avatar)}">`
                : `<div class="cond-avatar">${esc(ini)}</div>`;
            const ver = u.version ? this._buildNumToVersion(parseInt(String(u.version).replace('build-',''),10) || 0) : '—';
            return `<div class="cond-card">
                <div class="cond-top">
                    ${av}
                    <div class="cond-id" onclick="app._editarPuesto('${esc(u.email)}')">
                        <div class="cond-nombre">${esc(u.nombre) || esc(u.email)}
                            ${u.turno ? `<span class="cond-turno ${u.turno}">${u.turno}</span>` : ''}</div>
                        <div class="cond-num">${esc(u.conductor) || 'sin nº'}
                            ${u.puesto ? `<span class="cond-puesto">· ${esc(u.puesto)}</span>` : ''}</div>
                    </div>
                </div>
                <div class="cond-stats">
                    <div class="cond-stat"><div class="cond-stat-v">${(u.horasMes ?? 0).toFixed(1)}</div><div class="cond-stat-l">h este mes</div></div>
                    <div class="cond-stat"><div class="cond-stat-v">${u.diasMes ?? 0}</div><div class="cond-stat-l">días</div></div>
                    <div class="cond-stat"><div class="cond-stat-v">${(u.horasTotales ?? 0).toFixed(1)}</div><div class="cond-stat-l">h totales</div></div>
                </div>
                <div class="cond-ver">${ver} · ${u.actualizado ? new Date(u.actualizado).toLocaleDateString('es-ES') : ''}</div>
            </div>`;
        }).join('');
        document.getElementById('ordenNombre')?.classList.toggle('activo', orden === 'nombre');
        document.getElementById('ordenNumero')?.classList.toggle('activo', orden === 'numero');
        this._renderPuestos();
    },

    toggleSeccion(id) {
        const sec = document.getElementById(id);
        if (!sec) return;
        const cerrada = sec.classList.toggle('cerrada');
        localStorage.setItem('sec_' + id, cerrada ? '1' : '0');
    },

    _restaurarSecciones() {
        ['secPuestos', 'secTrabajadores'].forEach(id => {
            if (localStorage.getItem('sec_' + id) === '1')
                document.getElementById(id)?.classList.add('cerrada');
        });
    },

    ordenarTrabajadores(modo) {
        localStorage.setItem('ordenTrabajadores', modo);
        document.getElementById('ordenNombre')?.classList.toggle('activo', modo === 'nombre');
        document.getElementById('ordenNumero')?.classList.toggle('activo', modo === 'numero');
        this._renderConductores();
    },

    async _editarPuesto(email) {
        const u = (this._conductores || {})[email];
        if (!u) return;
        const v = prompt(`Puesto de trabajo de ${u.nombre || email}:`, u.puesto || '');
        if (v === null) return;
        try {
            const resp = await fetch(this.USUARIOS_URL, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json',
                           'X-Admin-Email': this.usuarioActual?.email || '' },
                body: JSON.stringify({ email, puesto: v.trim() })
            });
            const data = await resp.json();
            if (!resp.ok) { this._mostrarToast('❌ ' + (data.error || resp.status), 4000); return; }
            this._conductores = data;
            this._renderConductores();
            this._mostrarToast('✅ Puesto actualizado', 2500);
        } catch (e) { this._mostrarToast('❌ Error: ' + e.message, 4000); }
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
            const barPct = Math.min((m.horas / (this.horasAnualesCustom / 12)) * 100, 100);
            return `<div class="mes-row">
                <div class="mes-label">${m.label}</div>
                <div class="mes-bar-wrap"><div class="mes-bar" style="width:${barPct}%"></div></div>
                <div class="mes-vals">
                    <span>${m.horas}h</span>
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

    guardarPrecioNoche() {
        const precio = parseFloat(document.getElementById('precioNocheGlobal')?.value) || 0;
        this.precioNocheDefault = precio;
        localStorage.setItem('precioNoche', precio);
        this._guardarPreferencias();
    },

    async mostrarCambiarHoras() {
        const v = prompt('¿Cuántas horas quieres trabajar al año?', this.horasAnualesCustom);
        if (v === null) return;
        const n = this._leerDecimal(v);
        if (n === null || n <= 0) { alert('❌ Introduce un número de horas válido.'); return; }
        this.horasAnualesCustom = n;
        localStorage.setItem('horasAnuales', String(n));
        { const e = document.getElementById('horasAnualesDisplay'); if (e) e.textContent = n + 'h'; }
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
        if (!document.getElementById('workBanner')) return;
        const locs = this._getWorkLocations();
        if (locs.length === 0 || !navigator.geolocation) return;
        if (this.gpsMode === 'off') return;
        if (this.gpsMode === 'schedule' && !this._isInGpsSchedule()) return;
        const todayId = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        if (localStorage.getItem('lastRegisteredDate') === todayId) return;
        if (this._historialFull[todayId]) return;
        navigator.geolocation.getCurrentPosition((pos) => {
            const cercano = locs.some(loc =>
                this.calcularDistancia(pos.coords.latitude, pos.coords.longitude, loc.lat, loc.lng) < 300);
            if (cercano) {
                document.getElementById('workBanner').classList.add('show');
                this._enviarNotificacionTrabajo();
            }
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
                    title: '📍 Gestión EMT Movilidad',
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
            reg.showNotification('📍 Gestión EMT Movilidad', {
                body: 'Parece que estás en el trabajo. ¿Registras la jornada?',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'trabajo-cercano', requireInteraction: true,
                actions: [{ action: 'abrir', title: 'Abrir app' }]
            });
        } catch(_) {
            new Notification('📍 Gestión EMT Movilidad', { body: 'Parece que estás en el trabajo.', icon: '/icons/icon-192.png' });
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
                backgroundTitle: 'Gestión EMT Movilidad',
                requestPermissions: true,
                stale: false,
                distanceFilter: 200
            }, (location, error) => {
                if (error || !location) return;
                const ahora = Date.now();
                if (ahora - this._lastGeoCheck < this.gpsInterval * 60 * 1000) return;
                this._lastGeoCheck = ahora;
                const todayId = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                if (localStorage.getItem('lastRegisteredDate') === todayId) return;
                if (this._historialFull[todayId]) return;
                const locs = this._getWorkLocations();
                if (locs.length === 0) return;
                const cercano = locs.some(loc =>
                    this.calcularDistancia(location.latitude, location.longitude, loc.lat, loc.lng) < 300
                );
                if (cercano) {
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
                title: '📍 Gestión EMT Movilidad',
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
                    title: '🔔 Gestión EMT Movilidad — prueba',
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
            await reg.showNotification('🔔 Gestión EMT Movilidad — prueba', {
                body: 'Las notificaciones funcionan correctamente.',
                icon: '/icons/icon-192.png', badge: '/icons/badge.svg',
                tag: 'test-notif'
            });
        } catch(_) {
            new Notification('🔔 Gestión EMT Movilidad — prueba', { body: 'Las notificaciones funcionan correctamente.', icon: '/icons/icon-192.png' });
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
            horasAnualesCustom: this.horasAnualesCustom,
            jornadaHoras: this.jornadaHoras,
            numConductor: this.numConductor,
            backupFreq: this.backupFreq,
            vacaciones: this._getVacaciones(),
            workLocations: this._getWorkLocations(),
            notifSound: this.notifSound
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
        window.AndroidBridge?.saveToPrefs('gpsScheduleFrom', from);
        window.AndroidBridge?.saveToPrefs('gpsScheduleTo', to);
        this._renderGpsSettings();
        this._updateGpsState();
        this._guardarPreferencias();
    },

    _renderGpsSettings() {
        if (!document.getElementById('gpsIntervalSelect')) return;
        const radio = document.querySelector(`input[name="gpsMode"][value="${this.gpsMode}"]`);
        if (radio) radio.checked = true;
        const sel = document.getElementById('gpsIntervalSelect');
        if (sel) sel.value = String(this.gpsInterval);
        const fromEl = document.getElementById('gpsFrom');
        if (fromEl) fromEl.value = this.gpsScheduleFrom;
        const toEl = document.getElementById('gpsTo');
        if (toEl) toEl.value = this.gpsScheduleTo;
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

    // A management app must not fall open: if the list cannot be read, only the
    // gestor gets in. That check runs first and needs no network, so an outage
    // can never lock the gestor out.
    async _checkUserAuthorized(email) {
        if (email.toLowerCase() === SUPER_USER_EMAIL.toLowerCase()) return true;
        try {
            const resp = await fetch('https://registro-horario-emt.vercel.app/api/allowlist?app=' + ALLOWLIST_APP, { cache: 'no-store' });
            if (!resp.ok) return false;
            const allowed = await resp.json();
            if (!Array.isArray(allowed)) return false;
            return allowed.map(e => e.toLowerCase()).includes(email.toLowerCase());
        } catch(e) { return false; }
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
        const porEmail = this._conductores || {};
        el.innerHTML = emails.map(email => {
            const u = porEmail[String(email).toLowerCase()];
            const ver = u?.version
                ? this._buildNumToVersion(parseInt(String(u.version).replace('build-',''),10) || 0)
                : 'sin datos';
            return `<div class="access-user-item">
                <span class="access-user-email">${email}<br><span class="access-user-ver">${ver}</span></span>
                <button class="access-user-remove" onclick="app._removeUserAcceso('${email.replace(/'/g,"\\'")}\')" title="Eliminar">✕</button>
            </div>`;
        }).join('');
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

    async _checkForUpdates(showFeedback = false) {
        if (!window.Capacitor?.isNativePlatform?.()) return;
        if (typeof APP_VERSION === 'undefined' || APP_VERSION === '0') return;
        sessionStorage.setItem('lastUpdateCheck', String(Date.now()));
        try {
            // Both apps publish releases to the same repo, so pick only the ones
            // tagged for this app instead of whatever release is newest overall.
            const resp = await fetch('https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=30');
            if (!resp.ok) {
                if (showFeedback) this._mostrarToast('❌ No se pudo comprobar (error ' + resp.status + ')');
                return;
            }
            const lista = await resp.json();
            const re = new RegExp('^' + RELEASE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
            // El gestor siempre ve la última, para poder probarla antes de
            // publicarla; el resto solo ven la que él haya publicado.
            const soyGestor = (this.usuarioActual?.email || '').toLowerCase() === SUPER_USER_EMAIL.toLowerCase();
            let publicada = null;
            if (!soyGestor) {
                try {
                    const rv = await fetch(VERSION_URL, { cache: 'no-store' });
                    if (rv.ok) publicada = (await rv.json())?.build ?? null;
                } catch (_) {}
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
                if (showFeedback) this._mostrarToast('❌ No se pudo leer la versión de GitHub (' + latestTag + ')');
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
                if (currentNum > latestNum) {
                    this._mostrarToast('⚙️ Build de desarrollo ' + this._buildNumToVersion(currentNum) + ' (release oficial: ' + this._buildNumToVersion(latestNum) + ')');
                } else {
                    this._mostrarToast('✅ Tienes la versión más reciente (' + this._buildNumToVersion(currentNum) + ')');
                }
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
