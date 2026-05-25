(function(){var t=localStorage.getItem('tema');if(t&&t!=='azul')document.body.classList.add('theme-'+t);})();
'use strict';

const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive.appdata profile email';
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
    driveFileId: localStorage.getItem('driveFileId') || null,
    usuarioActual: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    horasAnualesCustom: parseFloat(localStorage.getItem('horasAnuales')) || HORAS_ANUALES,
    precioNocheDefault: parseFloat(localStorage.getItem('precioNoche')) || 0,
    modalCallback: null,
    editingId: null,
    prActivo: false,
    tema: localStorage.getItem('tema') || 'azul',
    _historialMap: {},
    _historialFull: {},
    _bgGeoStarted: false,
    _notifEnviadaAt: 0,
    _geoWatcherId: null,

    async init() {
        this._migrarUbicacionAntigua();
        this.setupUI();
        if (this.darkMode) this.aplicarDarkMode();
        this._buildAvatarGrid();
        this._setupDeepLinkListener();
        this._initGoogleAuth();
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
        const token = hashParams?.get('access_token') || searchParams?.get('access_token');
        const error = hashParams?.get('error') || searchParams?.get('error');

        if (token || error) {
            history.replaceState(null, '', window.location.pathname);
            if (token) {
                // Callback OAuth en Chrome (Android nativo): redirigir automáticamente a la app.
                // No se comprueba el origen porque Vercel puede tener distintas URLs de preview.
                if (!window.Capacitor && /Android/i.test(navigator.userAgent)) {
                    const exp = hashParams?.get('expires_in') || '3600';
                    const intentUrl = `intent://localhost/?access_token=${encodeURIComponent(token)}&expires_in=${exp}#Intent;scheme=https;package=com.guillermorc.horasemt;end`;
                    document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#1565C0;color:#fff;font-family:sans-serif;gap:20px;padding:32px;text-align:center;box-sizing:border-box;"><div style="font-size:56px;">✅</div><h2 style="margin:0;font-size:20px;font-weight:700;">¡Sesión iniciada!</h2><p style="margin:0;opacity:0.85;font-size:15px;">Abriendo la app...</p><a href="${intentUrl}" id="_oauthReturnBtn" style="background:#fff;color:#1565C0;padding:14px 28px;border-radius:12px;font-size:17px;font-weight:700;text-decoration:none;margin-top:8px;display:inline-block;">Abrir Horas EMT ›</a></div>`;
                    // Auto-redirect: equivalent to tapping the button
                    setTimeout(() => document.getElementById('_oauthReturnBtn')?.click(), 300);
                    return;
                }
                const expiresIn = parseInt(hashParams?.get('expires_in') || searchParams?.get('expires_in') || '3600');
                this.driveFileId = null;
                localStorage.removeItem('driveFileId');
                this._saveToken({ access_token: token, expires_in: expiresIn });
                this._loadUserAndStart();
                return;
            }
            this.mostrarAuth();
            this.mostrarMensaje('Error Google: ' + error, 'error');
            return;
        }
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            this._loadUserAndStart();
        } else {
            this.mostrarAuth();
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
        } catch (_) {}
    },

    _processOAuthUrl(url) {
        if (!url) return;
        try {
            const u = new URL(url);
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
    },

    async _loadUserAndStart() {
        try {
            const ok = await this._ensureToken();
            if (!ok) { this.mostrarAuth(); this.mostrarMensaje('Sesión expirada, vuelve a entrar', 'error'); return; }
            const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.accessToken}` }
            });
            if (!resp.ok) { this.mostrarAuth(); this.mostrarMensaje('Error al obtener perfil: ' + resp.status, 'error'); return; }
            this.usuarioActual = await resp.json();
            localStorage.setItem('gUserEmail', this.usuarioActual.email);
            this.mostrarApp();
            this.actualizarBotonesPerfil();
            setTimeout(() => this._autoRellenarFormulario(), 50);
            this.cargarDatos();
        } catch(e) {
            this.mostrarAuth();
            this.mostrarMensaje('Error de red: ' + e.message, 'error');
        }
    },

    login() {
        const isAndroidNative = !!(window.Capacitor?.isNativePlatform?.());
        const redirectUri = isAndroidNative
            ? 'https://registro-horario-emt.vercel.app/'
            : window.location.origin + '/';
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'token',
            scope: DRIVE_SCOPE,
            prompt: 'select_account'
        });
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
        // window.location.assign dispara shouldOverrideUrlLoading en Capacitor,
        // que lo intercepta y abre Chrome en lugar de navegar el WebView.
        window.location.assign(url);
    },

    _autoRellenarFormulario() {
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
            document.getElementById('precioNocheGlobal').value = this.precioNocheDefault;
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
        const json    = JSON.stringify(data);
        const fileId  = await this._getDriveFileId();

        if (!fileId) {
            const boundary = '-------314159265358979323846';
            const meta     = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'] });
            const body     = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
            const resp     = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
                body
            });
            const created  = await resp.json();
            this.driveFileId = created.id;
            localStorage.setItem('driveFileId', this.driveFileId);
            return;
        }
        await this._drivePatch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            json
        );
    },

    async cargarDatos() {
        try {
            const remote = await this._readDriveFile();
            const localRaw = localStorage.getItem('registros');
            const local    = localRaw ? JSON.parse(localRaw) : [];
            if (remote && remote.registros) {
                const merged = this._mergeRegistros(local, remote.registros);
                this._setRegistros(merged);
                if (JSON.stringify(merged) !== JSON.stringify(remote.registros)) {
                    await this._writeDriveFile({ registros: merged });
                }
            } else if (local.length > 0) {
                await this._writeDriveFile({ registros: local });
            }
        } catch(e) {
            this.mostrarMensaje('Error al cargar datos: ' + e.message, 'error');
        }
    },

    _mergeRegistros(local, remote) {
        const map = {};
        [...remote, ...local].forEach(r => { map[r.id] = r; });
        return Object.values(map).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
    },

    _setRegistros(registros) {
        localStorage.setItem('registros', JSON.stringify(registros));
        this.actualizarStats();
        this.renderHistorial();
        this.renderPorMes();
    },