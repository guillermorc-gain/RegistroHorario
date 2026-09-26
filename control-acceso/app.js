// Control de acceso: el registro de la garita (quién entra y sale del recinto)
// y el Excel de siempre que sale de él.
//
// Es una sola web que hace de dos aplicaciones, igual que horas y gestión:
//
//   · la del trabajador («EMT - Movilidad (Control de acceso)») apunta las
//     entradas a mano en la garita;
//   · la de gestión («Gestion (Control de acceso)») ve todo lo apuntado, lo
//     corrige, pasa hojas escritas a mano con una foto, lleva Datos (el
//     fichero de personas) y descarga o carga los Excel.
//
// Lo que se apunta se guarda primero en el móvil y se sube en cuanto hay
// conexión (/api/acceso), así que la garita puede seguir apuntando aunque se
// corte internet un rato. Gestión lo recibe al sincronizar.
//
// Datos funciona como la macro del Excel: al escribir una matrícula o un
// nombre que ya está, se rellena el resto; quien no está se guarda en Datos
// para la próxima vez.
//
// ES2017 a propósito (sin «?.» ni «??»): hay móviles y navegadores con los
// que, si no, la página ni arranca.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CAMPOS_DATOS = ['nombre', 'matricula', 'marca', 'empresa', 'motivo'];
const CAMPOS_LISTADO = ['fecha', 'nombre', 'dni', 'matricula', 'marca', 'empresa', 'entrada', 'salida', 'motivo', 'obs'];
// Lo que se trae de Datos al reconocer a alguien (lo que rellenaba la macro)
const DE_DATOS = ['nombre', 'matricula', 'marca', 'empresa', 'motivo'];

const SERVIDOR = 'https://registro-horario-emt.vercel.app';
const GOOGLE_CLIENT_ID = '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';
const NATIVA = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// Dentro del APK la página es https://localhost: la API está en el servidor.
// En la web, la del mismo sitio (así también funciona en las de prueba).
const API = NATIVA ? SERVIDOR : '';
const meta = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content.trim() : ''; };
const ROL_APP = meta('app-rol') || 'web';          // trabajador | gestion | web
const PAQUETE = meta('app-paquete');
const VERSION = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0';
const PREFIJO_RELEASE = ROL_APP === 'gestion' ? 'acceso-gestion-build-' : 'acceso-build-';
const REPO_API = 'https://api.github.com/repos/guillermorc-gain/RegistroHorario/releases?per_page=100';

// Tesseract se descarga la primera vez que se usa (unos 6 MB) y luego queda
// en la caché del navegador. Versiones fijas para que no cambie solo.
const TESS = {
    script: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int',
};

const CLAVE = 'controlAcceso.v3';
const CLAVE_SESION = 'controlAcceso.sesion';

const $ = id => document.getElementById(id);
const vaciar = el => { while (el.firstChild) el.removeChild(el.firstChild); };
const filaDe = el => { const tr = el.closest('tr'); return tr ? tr.dataset.id : ''; };
const dos = n => String(n).padStart(2, '0');
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
const ayer = () => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
const ahora = () => { const d = new Date(); return `${dos(d.getHours())}:${dos(d.getMinutes())}`; };
const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = s => sinAcentos(s).toLowerCase().replace(/\s+/g, ' ').trim();
const normMat = m => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Como se escriben en el Excel: 1234-ABC
const fmtMat = m => {
    const n = normMat(m);
    if (/^\d{4}[A-Z]{3}$/.test(n)) return n.slice(0, 4) + '-' + n.slice(4);
    return String(m || '').trim().toUpperCase();
};
// Un "-" o vacío no identifica a nadie
const util = v => { const s = String(v || '').trim(); return s && s !== '-' ? s : ''; };
const nombreMes = c => { const [a, m] = c.split('-'); return `${MESES[+m - 1][0].toUpperCase()}${MESES[+m - 1].slice(1)} ${a}`; };
const fmtFechaCorta = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}`; };
const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control: Excel se niega a abrir el archivo si aparecen
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// Safari de Mac antiguo, Firefox de escritorio y navegadores viejos no tienen
// selector de fecha u hora: ahí esos campos son de texto y se escriben a mano
// (dd/mm/aaaa y hh:mm). Todo lo que lee o escribe fechas y horas pasa por
// leer() y poner() para que dé igual cuál de los dos haya.
const soporta = t => { const i = document.createElement('input'); i.setAttribute('type', t); return i.type === t; };
const NATIVO = { fecha: soporta('date'), hora: soporta('time') };
const textoAFecha = v => {
    const m = String(v || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${dos(m[2])}-${dos(m[1])}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '';
};
const aHora = v => {
    const s = String(v || '').trim();
    const m = s.match(/^(\d{1,2})\s*[:.,hH]?\s*(\d{2})$/);
    if (m && +m[1] < 24 && +m[2] < 60) return `${dos(m[1])}:${m[2]}`;
    return s;   // «-» y cosas así se dejan como están
};
const leer = inp => {
    const t = inp.dataset.tipo, v = inp.value.trim();
    if (t === 'fecha') return NATIVO.fecha ? v : textoAFecha(v);
    if (t === 'hora') return aHora(v);
    return v;
};
const poner = (inp, v) => {
    const t = inp.dataset.tipo;
    if (t === 'fecha' && !NATIVO.fecha) { inp.value = /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('/') : ''; inp.placeholder = 'dd/mm/aaaa'; }
    else if (t === 'hora' && !NATIVO.hora) { inp.value = v || ''; inp.placeholder = 'hh:mm'; }
    else inp.value = v || '';
};
const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const leerLocal = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };

const ca = {
    // Lo que hay en el servidor (más lo pendiente de subir, ya aplicado)
    personas: [],
    meses: {},              // 'AAAA-MM' → [registros]
    pendientes: [],         // cambios aún sin subir
    yo: null,               // { email, gestor }
    mes: hoy().slice(0, 7),
    borrador: { fecha: hoy(), filas: [] },
    fotos: [],
    sesion: null,           // { token, expira, refresh, email }

    get esGestion() {
        if (ROL_APP === 'trabajador') return false;
        if (ROL_APP === 'gestion') return true;
        return !!(this.yo && this.yo.gestor);
    },

    // ── Arranque ────────────────────────────────────────────────────────
    async iniciar() {
        const g = leerLocal(CLAVE);
        if (g) {
            this.personas = g.personas || [];
            this.meses = g.meses || {};
            this.pendientes = g.pendientes || [];
            this.yo = g.yo || null;
            if (g.borrador && Array.isArray(g.borrador.filas)) this.borrador = g.borrador;
            if (/^\d{4}-\d{2}$/.test(g.mes || '')) this.mes = g.mes;
        }
        this.sesion = leerLocal(CLAVE_SESION);

        const nombre = ROL_APP === 'gestion' ? 'Gestion (Control de acceso)'
            : ROL_APP === 'trabajador' ? 'EMT - Movilidad (Control de acceso)' : 'Control de acceso';
        $('tituloEntrar').textContent = nombre;
        document.title = nombre;
        if (ROL_APP === 'gestion') { document.body.classList.add('gestion'); $('logoEntrar').src = 'icons/icon-gestion-192.png'; }

        const f = $('formEntrada');
        poner(f.fecha, hoy());
        poner(f.entrada, ahora());
        poner(f.salida, '');
        f.matricula.addEventListener('input', () => this._completarForm('matricula'));
        f.nombre.addEventListener('input', () => this._completarForm('nombre'));
        for (const id of ['tablaListado', 'tablaDatos', 'tablaBorrador']) {
            $(id).addEventListener('change', e => this._editar(e, id));
            $(id).addEventListener('click', e => this._accion(e, id));
        }
        poner($('fechaHoja'), this.borrador.fecha || hoy());
        window.addEventListener('online', () => this.sincronizar());
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sincronizar(); });
        setInterval(() => { if (!document.hidden) this.sincronizar(); }, 30000);

        // ¿Vuelve de Google con el código?
        const q = new URLSearchParams(location.search);
        if (q.get('code')) {
            history.replaceState(null, '', location.pathname);
            await this._canjear(q.get('code'));
        } else if (q.get('error')) {
            history.replaceState(null, '', location.pathname);
            this._mostrarEntrar('No se ha completado la entrada con Google.');
            return;
        }
        if (!this.sesion) { this._mostrarEntrar(); return; }
        this._mostrarApp();
        this.sincronizar();
        this._buscarVersion();
    },

    _mostrarEntrar(mensaje) {
        $('pantallaApp').hidden = true;
        $('pantallaEntrar').hidden = false;
        const m = $('mensajeEntrar');
        m.hidden = !mensaje;
        m.textContent = mensaje || '';
    },

    _mostrarApp() {
        $('pantallaEntrar').hidden = true;
        $('pantallaApp').hidden = false;
        this._aplicarRol();
        this.pintar();
    },

    // Gestión ve todo el mes y todas las pestañas; el trabajador, lo de su
    // día en la garita.
    _aplicarRol() {
        const g = this.esGestion;
        document.body.classList.toggle('gestion', g);
        document.querySelectorAll('[data-solo="gestion"]').forEach(el => { el.hidden = !g; });
        $('titulo').textContent = g ? '✏️ Control de acceso · Gestión' : '🚧 Control de acceso';
        $('selectorMes').hidden = !g;
        if (!g) this.pestana('listado');
        $('quienSoy').textContent = this.sesion ? this.sesion.email || '' : '';
    },

    guardar() {
        const ok = guardarLocal(CLAVE, {
            personas: this.personas, meses: this.meses, pendientes: this.pendientes,
            yo: this.yo, borrador: this.borrador, mes: this.mes,
        });
        if (!ok) this.aviso('No se ha podido guardar en el móvil: no cierres la app hasta que sincronice.', true);
    },

    listado(c = this.mes) {
        if (!this.meses[c]) this.meses[c] = [];
        return this.meses[c];
    },

    // ── Sesión con Google ───────────────────────────────────────────────
    _verificador() {
        const a = new Uint8Array(32);
        crypto.getRandomValues(a);
        return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    async _reto(v) {
        const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
        return btoa(String.fromCharCode.apply(null, new Uint8Array(h))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    },

    // La vuelta de Google es siempre la página principal del servidor (es la
    // que está dada de alta en Google). Desde allí se devuelve el código: a la
    // aplicación del móvil por su paquete, o a esta página en el navegador.
    async entrar() {
        const v = this._verificador();
        try { localStorage.setItem('controlAcceso.pkce', v); } catch (_) {}
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: SERVIDOR + '/',
            response_type: 'code',
            scope: 'openid email profile',
            code_challenge: await this._reto(v),
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'select_account consent',
            state: NATIVA ? 'app:' + PAQUETE : 'web:acceso',
        });
        const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
        if (NATIVA && window.AndroidBridge && window.AndroidBridge.performOAuthInWebView) {
            window.AndroidBridge.performOAuthInWebView(url, false);
        } else {
            location.assign(url);
        }
    },

    // La app nativa llama aquí si la entrada fue por su ventana propia
    _onOAuthCode(code) {
        if (code) this._canjear(code).then(() => { if (this.sesion) { this._mostrarApp(); this.sincronizar(); } });
        else this._mostrarEntrar('No se ha completado la entrada con Google.');
    },

    async _canjear(code) {
        let v = null;
        try { v = localStorage.getItem('controlAcceso.pkce'); localStorage.removeItem('controlAcceso.pkce'); } catch (_) {}
        if (!v) { this._mostrarEntrar('La entrada ha caducado. Vuelve a intentarlo.'); return; }
        try {
            const r = await fetch(SERVIDOR + '/api/auth/exchange', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, code_verifier: v, redirect_uri: SERVIDOR + '/' }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || r.status);
            this._guardarSesion(d);
            const email = await this._correo(d.access_token);
            this.sesion.email = email;
            guardarLocal(CLAVE_SESION, this.sesion);
            // Otra cuenta en el mismo móvil: fuera lo de la anterior
            if (this.yo && this.yo.email && this.yo.email !== email) {
                this.meses = {}; this.personas = []; this.pendientes = []; this.yo = null;
                this.guardar();
            }
        } catch (e) {
            this.sesion = null;
            this._mostrarEntrar('No se ha podido entrar: ' + (e.message || e));
        }
    },

    _guardarSesion(d) {
        this.sesion = Object.assign({}, this.sesion || {}, {
            token: d.access_token,
            expira: Date.now() + (parseInt(d.expires_in, 10) - 60) * 1000,
        });
        if (d.refresh_token) this.sesion.refresh = d.refresh_token;
        guardarLocal(CLAVE_SESION, this.sesion);
    },

    async _correo(token) {
        try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
            const d = await r.json();
            return String(d.email || '').toLowerCase();
        } catch (_) { return ''; }
    },

    async token() {
        const s = this.sesion;
        if (!s) return null;
        if (s.token && Date.now() < s.expira) return s.token;
        if (!s.refresh) return null;
        try {
            const r = await fetch(SERVIDOR + '/api/auth/refresh', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: s.refresh }),
            });
            if (r.status === 400) { this.sesion = null; guardarLocal(CLAVE_SESION, null); return null; }
            if (!r.ok) return 'sin-red';
            this._guardarSesion(await r.json());
            return this.sesion.token;
        } catch (_) { return 'sin-red'; }
    },

    salir() {
        if (this.pendientes.length && !confirm(`Hay ${this.pendientes.length} cambios sin subir todavía. Si sales ahora se pierden. ¿Salir igualmente?`)) return;
        this.sesion = null;
        guardarLocal(CLAVE_SESION, null);
        this.meses = {}; this.personas = []; this.pendientes = []; this.yo = null;
        this.guardar();
        this._mostrarEntrar();
    },

    // ── Sincronización ──────────────────────────────────────────────────
    async _api(metodo, ruta, cuerpo) {
        const t = await this.token();
        if (t === 'sin-red') { const e = new Error('Sin conexión'); e.red = true; throw e; }
        if (!t) { const e = new Error('Sesión caducada'); e.sesion = true; throw e; }
        let r;
        try {
            r = await fetch(API + ruta, {
                method: metodo,
                headers: Object.assign({ Authorization: 'Bearer ' + t }, cuerpo ? { 'Content-Type': 'application/json' } : {}),
                body: cuerpo ? JSON.stringify(cuerpo) : undefined,
                cache: 'no-store',
            });
        } catch (_) { const e = new Error('Sin conexión'); e.red = true; throw e; }
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) { const e = new Error(d.error || 'Sesión caducada'); e.sesion = true; throw e; }
        if (r.status === 403) { const e = new Error(d.error || 'Sin acceso'); e.acceso = true; throw e; }
        if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
        return d;
    },

    _estadoSync(texto) { $('estadoSync').textContent = texto; },

    _anotar(op) {
        // Un cambio nuevo sobre el mismo registro sustituye al anterior
        if (op.t === 'g' || op.t === 'b') this.pendientes = this.pendientes.filter(p => !((p.t === 'g' || p.t === 'b') && p.id === op.id));
        if (op.t === 'p' || op.t === 'pb') this.pendientes = this.pendientes.filter(p => !((p.t === 'p' || p.t === 'pb') && p.id === op.id));
        this.pendientes.push(op);
        this.guardar();
        clearTimeout(this._tSync);
        this._tSync = setTimeout(() => this.sincronizar(), 800);
    },

    async sincronizar() {
        if (!this.sesion) return;
        if (this._sincronizando) { this._otraVez = true; return; }
        this._sincronizando = true;
        this._estadoSync('⟳ Sincronizando…');
        try {
            await this._subir();
            if (this.esGestion) await this.cargarMes(this.mes);
            else {
                // La garita trabaja con hoy (y con ayer, por quien sigue dentro)
                this.mes = hoy().slice(0, 7);
                await this.cargarMes(this.mes);
                if (ayer().slice(0, 7) !== this.mes) await this.cargarMes(ayer().slice(0, 7));
            }
            this._estadoSync(`✓ Al día · ${ahora()}`);
        } catch (e) {
            if (e.sesion) { this.sesion = null; guardarLocal(CLAVE_SESION, null); this._mostrarEntrar('La sesión ha caducado. Vuelve a entrar (lo apuntado no se pierde).'); }
            else if (e.acceso) { this._mostrarEntrar(e.message); }
            else if (e.red) this._estadoSync(`📴 Sin conexión${this.pendientes.length ? ` · ${this.pendientes.length} por subir` : ''}`);
            else this._estadoSync('⚠️ ' + e.message);
        } finally {
            this._sincronizando = false;
            if (this._otraVez) { this._otraVez = false; setTimeout(() => this.sincronizar(), 200); }
        }
    },

    async _subir() {
        const lote = this.pendientes.slice();
        if (!lote.length) return;
        // Datos primero: si no, el servidor apunta como nuevas a las personas
        // de los registros antes de recibirlas, y quedan repetidas.
        const pers = lote.filter(p => p.t === 'p' || p.t === 'pb');
        if (pers.length) {
            await this._api('POST', '/api/acceso', {
                accion: 'personas',
                personas: pers.filter(p => p.t === 'p').map(p => p.p),
                borrar: pers.filter(p => p.t === 'pb').map(p => p.id),
            });
            this._quitar(pers);
        }
        const guardar = lote.filter(p => p.t === 'g');
        for (let i = 0; i < guardar.length; i += 200) {
            const trozo = guardar.slice(i, i + 200);
            const d = await this._api('POST', '/api/acceso', { accion: 'guardar', registros: trozo.map(p => p.r) });
            const rechazados = d.rechazados || [];
            if (rechazados.length) this.aviso(`${rechazados.length} registro(s) no se han podido guardar (demasiado antiguos para la garita o incompletos).`, true);
            this._quitar(trozo);
        }
        const borrar = lote.filter(p => p.t === 'b');
        const porMes = {};
        borrar.forEach(p => { (porMes[p.mes] = porMes[p.mes] || []).push(p); });
        for (const mes of Object.keys(porMes)) {
            await this._api('POST', '/api/acceso', { accion: 'borrar', mes, ids: porMes[mes].map(p => p.id) });
            this._quitar(porMes[mes]);
        }
    },

    _quitar(ops) {
        this.pendientes = this.pendientes.filter(p => ops.indexOf(p) < 0);
        this.guardar();
    },

    // Lo del servidor manda, salvo lo que aún está por subir desde aquí
    async cargarMes(mes) {
        const d = await this._api('GET', '/api/acceso?mes=' + mes);
        const antesGestion = this.esGestion;
        this.yo = d.yo;
        const regs = d.registros || [];
        const porId = new Map(regs.map(r => [r.id, r]));
        for (const p of this.pendientes) {
            if (p.t === 'g' && p.r.fecha.slice(0, 7) === mes) porId.set(p.id, Object.assign({}, porId.get(p.id) || {}, p.r, { _pendiente: true }));
            // Cambiado de mes aquí y aún sin subir: en el servidor sigue en el viejo
            if (p.t === 'g' && p.r.fecha.slice(0, 7) !== mes) porId.delete(p.id);
            if (p.t === 'b' && p.mes === mes) porId.delete(p.id);
        }
        this.meses[mes] = [...porId.values()];
        const pers = new Map((d.personas || []).map(p => [p.id, p]));
        for (const p of this.pendientes) {
            if (p.t === 'p') pers.set(p.id, p.p);
            if (p.t === 'pb') pers.delete(p.id);
        }
        this.personas = [...pers.values()];
        this.guardar();
        if (antesGestion !== this.esGestion) this._aplicarRol();
        this.pintar();
        return this.meses[mes];
    },

    // ── Mes y pestañas ──────────────────────────────────────────────────
    cambiarMes(valor) {
        if (!/^\d{4}-\d{2}$/.test(valor || '')) return;
        this.mes = valor;
        this.guardar();
        const f = $('formEntrada');
        if (this.esGestion && leer(f.fecha).slice(0, 7) !== valor) poner(f.fecha, valor === hoy().slice(0, 7) ? hoy() : valor + '-01');
        this.pintar();
        this.sincronizar();
    },

    _pintarSelectorMes() {
        const sm = $('selMes'), sa = $('selAnio');
        if (!sm.options.length) MESES.forEach((m, i) => sm.add(new Option(m[0].toUpperCase() + m.slice(1), dos(i + 1))));
        const anios = new Set(Object.keys(this.meses).map(k => +k.slice(0, 4)));
        const actual = new Date().getFullYear();
        for (let a = actual - 2; a <= actual + 1; a++) anios.add(a);
        anios.add(+this.mes.slice(0, 4));
        vaciar(sa);
        [...anios].sort().forEach(a => sa.add(new Option(String(a), String(a))));
        sm.value = this.mes.slice(5, 7);
        sa.value = this.mes.slice(0, 4);
    },

    elegirMes() { this.cambiarMes(`${$('selAnio').value}-${$('selMes').value}`); },

    moverMes(paso) {
        const [a, m] = this.mes.split('-').map(Number);
        const d = new Date(a, m - 1 + paso, 1);
        this.cambiarMes(`${d.getFullYear()}-${dos(d.getMonth() + 1)}`);
    },

    pestana(nombre) {
        for (const p of ['listado', 'hoja', 'datos', 'excel', 'personal']) $('p-' + p).hidden = p !== nombre;
        document.querySelectorAll('nav button').forEach(b => b.classList.toggle('activa', b.dataset.pestana === nombre));
        this.pestanaActual = nombre;
        if (nombre === 'personal') this.cargarTrabajadores();
    },

    // Atrás del móvil: primero vuelve al listado; en el listado, sale
    atras() {
        if (this.pestanaActual && this.pestanaActual !== 'listado') { this.pestana('listado'); return true; }
        return false;
    },

    // ── Búsquedas en Datos ──────────────────────────────────────────────
    porMatricula(m) {
        const n = normMat(m);
        if (!n) return null;
        for (let i = this.personas.length - 1; i >= 0; i--) if (normMat(this.personas[i].matricula) === n) return this.personas[i];
        return null;
    },

    porNombre(nombre) {
        const k = clave(nombre);
        if (!k || k === '-') return null;
        for (let i = this.personas.length - 1; i >= 0; i--) if (clave(this.personas[i].nombre) === k) return this.personas[i];
        return null;
    },

    // Quien no está en Datos se añade (el servidor hace lo mismo al recibir
    // el registro; aquí es para que salga ya sin esperar a sincronizar).
    _registrarLocal(f) {
        const mat = util(f.matricula), nom = util(f.nombre);
        if (!mat && !nom) return false;
        if (mat ? this.porMatricula(mat) : this.porNombre(nom)) return false;
        const p = { id: nuevoId(), color: 0 };
        for (const c of CAMPOS_DATOS) p[c] = f[c] || '';
        this.personas.push(p);
        return true;
    },

    // ── Registros ───────────────────────────────────────────────────────
    _guardarRegistro(fila, anterior) {
        const r = { id: fila.id };
        for (const c of CAMPOS_LISTADO) r[c] = fila[c] || '';
        r.matricula = fmtMat(r.matricula);
        if (anterior) ['autor', 'creado', 'origen'].forEach(k => { if (anterior[k]) r[k] = anterior[k]; });
        else { r.autor = this.sesion ? this.sesion.email : ''; r.origen = this.esGestion ? 'gestion' : 'garita'; }
        const mes = r.fecha.slice(0, 7);
        // Si cambió de mes, sale del viejo
        if (anterior && anterior.fecha && anterior.fecha.slice(0, 7) !== mes) {
            const viejo = this.listado(anterior.fecha.slice(0, 7));
            const i = viejo.findIndex(x => x.id === r.id);
            if (i >= 0) viejo.splice(i, 1);
        }
        const l = this.listado(mes);
        const i = l.findIndex(x => x.id === r.id);
        const local = Object.assign({}, anterior || {}, r, { _pendiente: true });
        if (i >= 0) l[i] = local; else l.push(local);
        const nuevo = this._registrarLocal(r);
        this._anotar({ t: 'g', id: r.id, r });
        return nuevo;
    },

    _completarForm(desde) {
        const f = $('formEntrada');
        const p = desde === 'matricula' ? this.porMatricula(f.matricula.value) : this.porNombre(f.nombre.value);
        const estado = $('estadoBusqueda');
        for (const campo of DE_DATOS) {
            if (campo === desde) continue;
            const inp = f[campo];
            if (inp.classList.contains('auto') || !inp.value) {
                inp.value = p ? (campo === 'matricula' ? fmtMat(p.matricula) : p[campo] || '') : '';
                inp.classList.toggle('auto', !!p);
            }
        }
        const escrito = f[desde].value.trim();
        if (!escrito) { estado.textContent = ''; estado.className = 'estado-busqueda'; }
        else if (p) { estado.textContent = `✓ ${p.nombre || 'Sin nombre'} · ${p.empresa || 'sin empresa'}`; estado.className = 'estado-busqueda ok'; }
        else { estado.textContent = 'No está en Datos: se guardará al añadir.'; estado.className = 'estado-busqueda nuevo'; }
    },

    anadirEntrada() {
        const f = $('formEntrada');
        const fila = { id: nuevoId() };
        for (const c of CAMPOS_LISTADO) fila[c] = leer(f[c]);
        if (!fila.fecha) { this.aviso('Pon la fecha (dd/mm/aaaa).', true); return; }
        if (!this.esGestion && fila.fecha !== hoy() && fila.fecha !== ayer()) { this.aviso('En la garita solo se apunta lo de hoy o de ayer.', true); return; }
        if (!['nombre', 'matricula', 'marca', 'empresa'].some(k => util(fila[k]))) { this.aviso('Pon al menos la matrícula o el nombre.', true); return; }
        const nuevo = this._guardarRegistro(fila, null);
        if (this.esGestion && fila.fecha.slice(0, 7) !== this.mes) this.cambiarMes(fila.fecha.slice(0, 7));
        for (const c of CAMPOS_LISTADO) if (c !== 'fecha') { f[c].value = ''; f[c].classList.remove('auto'); }
        poner(f.entrada, ahora());
        $('estadoBusqueda').textContent = '';
        this.pintar();
        this.aviso(nuevo ? 'Apuntado, y guardado en Datos.' : 'Apuntado.');
        f.matricula.focus();
    },

    // ── Pintado ─────────────────────────────────────────────────────────
    pintar() {
        if (this.esGestion) this._pintarSelectorMes();
        const l = this._filasVisibles();
        $('nListado').textContent = l.length ? `(${l.length})` : '';
        $('nDatos').textContent = this.personas.length ? `(${this.personas.length})` : '';
        $('nombreExcel').textContent = `«${this._nombreArchivo()}»`;
        this.pintarListado();
        this.pintarDatos();
        this.pintarBorrador();
        this._pintarResumen();
        this._pintarListas();
        if (this.pestanaActual === 'personal') this._pintarTrabajadores();
    },

    // El trabajador ve lo de hoy y lo de ayer que sigue dentro (sin salida)
    _filasVisibles() {
        if (this.esGestion) return this.listado();
        const h = hoy(), a = ayer();
        const todas = this.listado(h.slice(0, 7)).concat(a.slice(0, 7) !== h.slice(0, 7) ? this.listado(a.slice(0, 7)) : []);
        return todas.filter(r => r.fecha === h || (r.fecha === a && !r.salida));
    },

    _ordenar(filas) {
        return filas.slice().sort((a, b) =>
            (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.entrada || '99').localeCompare(b.entrada || '99'));
    },

    _input(campo, valor, desactivado) {
        const inp = document.createElement('input');
        inp.dataset.campo = campo;
        if (campo === 'fecha') { inp.dataset.tipo = 'fecha'; if (NATIVO.fecha) inp.type = 'date'; }
        else if (campo === 'entrada' || campo === 'salida') { inp.dataset.tipo = 'hora'; if (NATIVO.hora) inp.type = 'time'; }
        poner(inp, valor);
        if (desactivado) inp.disabled = true;
        return inp;
    },

    _icono(txt, accion, titulo) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'icono'; b.textContent = txt; b.title = titulo; b.dataset.accion = accion;
        return b;
    },

    _vacio(tbody, cols, texto) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = cols; td.className = 'vacio'; td.textContent = texto;
        tr.append(td); tbody.append(tr);
    },

    pintarListado() {
        const tbody = $('tablaListado');
        vaciar(tbody);
        const g = this.esGestion;
        $('ayudaListado').textContent = g ? `Todo lo apuntado en ${nombreMes(this.mes)}, de todas las garitas.`
            : 'Lo de hoy (y lo de ayer que no tiene salida). Toca ⏱ cuando alguien se vaya.';
        const filas = this._ordenar(this._filasVisibles());
        const yo = this.sesion ? this.sesion.email : '';
        $('cajaListado').hidden = !g;
        $('tarjetasGarita').hidden = g;
        if (!g) { this._pintarTarjetas(filas, yo); return; }
        if (!filas.length) { this._vacio(tbody, 12, `El listado de ${nombreMes(this.mes)} está vacío.`); return; }
        filas.forEach((f, i) => {
            const tr = document.createElement('tr');
            tr.dataset.id = f.id;
            const primera = i === 0 || filas[i - 1].fecha !== f.fecha;
            const clases = [];
            if (i === filas.length - 1 || filas[i + 1].fecha !== f.fecha) clases.push('fin-dia');
            if (f._pendiente) clases.push('pendiente');
            tr.className = clases.join(' ');
            for (const c of CAMPOS_LISTADO) {
                const td = document.createElement('td');
                // La fecha se ve solo en la primera fila del día, como en el Excel
                if (c === 'fecha' && !primera) { tr.append(td); continue; }
                td.append(this._input(c, f[c], c === 'fecha' && !g));
                tr.append(td);
            }
            const autor = document.createElement('td');
            autor.className = 'autor';
            autor.textContent = f.autor ? f.autor.split('@')[0] : (f.origen === 'excel' ? 'Excel' : '');
            autor.title = f._pendiente ? 'Pendiente de subir' : (f.autor || '');
            tr.append(autor);
            const acc = document.createElement('td');
            acc.className = 'acc';
            if (!f.salida) acc.append(this._icono('⏱', 'salida', 'Poner la hora de salida ahora'));
            if (g || f.autor === yo) acc.append(this._icono('🗑', 'borrar', 'Borrar fila'));
            tr.append(acc);
            tbody.append(tr);
        });
    },

    // En la garita, una tarjeta por entrada: se lee de un vistazo en el
    // móvil y la salida se marca con un toque.
    _pintarTarjetas(filas, yo) {
        const caja = $('tarjetasGarita');
        vaciar(caja);
        if (!filas.length) {
            const p = document.createElement('p');
            p.className = 'vacio'; p.textContent = 'Hoy aún no hay nadie apuntado.';
            caja.append(p); return;
        }
        // Lo último arriba, que es lo que se busca
        filas.slice().reverse().forEach(f => {
            const d = document.createElement('div');
            d.className = 'entrada' + (f.salida ? ' fuera' : '');
            d.dataset.id = f.id;
            const horas = document.createElement('div');
            horas.className = 'horas';
            horas.textContent = f.entrada || '—';
            const sal = document.createElement('small');
            sal.textContent = f.salida ? 'sale ' + f.salida : (f.fecha !== hoy() ? 'desde ayer' : 'dentro');
            horas.append(sal);
            const quien = document.createElement('div');
            quien.className = 'quien';
            const bn = document.createElement('b');
            bn.textContent = [fmtMat(f.matricula), util(f.nombre)].filter(util).join(' · ') || '—';
            const sp = document.createElement('span');
            sp.textContent = [f.empresa, f.marca, f.motivo].filter(util).join(' · ') + (f._pendiente ? '  ⏳ por subir' : '');
            quien.append(bn, sp);
            d.append(horas, quien);
            if (!f.salida) {
                const b = document.createElement('button');
                b.type = 'button'; b.className = 'btn'; b.textContent = '⏱ Salida';
                b.onclick = () => { this._guardarRegistro(Object.assign({}, f, { salida: ahora() }), f); this.pintar(); };
                d.append(b);
            }
            if (f.autor === yo || f._pendiente) {
                const x = this._icono('🗑', 'borrar', 'Borrar');
                x.onclick = () => {
                    if (!confirm(`¿Borrar la entrada de ${f.nombre || f.matricula || 'esta persona'}?`)) return;
                    const l = this.listado(f.fecha.slice(0, 7));
                    l.splice(l.indexOf(f), 1);
                    this._anotar({ t: 'b', id: f.id, mes: f.fecha.slice(0, 7) });
                    this.pintar();
                };
                d.append(x);
            }
            caja.append(d);
        });
    },

    pintarDatos() {
        const tbody = $('tablaDatos');
        vaciar(tbody);
        const q = clave($('filtroDatos').value);
        const qm = normMat($('filtroDatos').value);
        const filas = this.personas.filter(d => !q ||
            CAMPOS_DATOS.some(c => clave(d[c]).includes(q)) || (qm && normMat(d.matricula).includes(qm)));
        if (!filas.length) {
            this._vacio(tbody, 6, this.personas.length ? 'Nada coincide con la búsqueda.'
                : 'Aún no hay nadie. Carga tu Excel en la pestaña Excel, o se irán añadiendo al apuntar entradas.');
            return;
        }
        for (const d of filas) {
            const tr = document.createElement('tr');
            tr.dataset.id = d.id;
            if (d.color) tr.className = 'color-' + d.color;
            for (const c of CAMPOS_DATOS) {
                const td = document.createElement('td');
                td.append(this._input(c, d[c]));
                tr.append(td);
            }
            const acc = document.createElement('td');
            acc.className = 'acc';
            acc.append(this._icono('🗑', 'borrar', 'Quitar de Datos'));
            tr.append(acc);
            tbody.append(tr);
        }
    },

    pintarBorrador() {
        const tbody = $('tablaBorrador');
        vaciar(tbody);
        if (!this.borrador.filas.length) {
            this._vacio(tbody, 11, 'Sin filas. Añádelas mirando la foto, o prueba la lectura automática.');
            return;
        }
        for (const f of this.borrador.filas) {
            const tr = document.createElement('tr');
            tr.dataset.id = f.id;
            const conocido = util(f.matricula) ? this.porMatricula(f.matricula) : this.porNombre(f.nombre);
            if (!conocido || f.revisar) { tr.className = 'revisar'; tr.title = f.nota || 'No está en Datos: revisa la matrícula'; }
            const leido = document.createElement('td');
            leido.className = 'leido';
            leido.textContent = [f.leido ? `«${f.leido}»` : '', f.nota || ''].filter(Boolean).join(' — ') || '—';
            tr.append(leido);
            for (const c of CAMPOS_LISTADO) {
                if (c === 'fecha') continue;
                const td = document.createElement('td');
                td.append(this._input(c, f[c]));
                tr.append(td);
            }
            const acc = document.createElement('td');
            acc.className = 'acc';
            acc.append(this._icono('🗑', 'borrar', 'Quitar fila'));
            tr.append(acc);
            tbody.append(tr);
        }
    },

    _pintarResumen() {
        const l = this.listado();
        const dias = new Set(l.map(f => f.fecha)).size;
        const personas = new Set(l.map(f => normMat(f.matricula) || clave(f.nombre)).filter(Boolean)).size;
        const res = $('resumenMes');
        vaciar(res);
        for (const [n, t] of [[l.length, 'entradas'], [dias, 'días'], [personas, 'personas distintas'], [this.personas.length, 'en Datos']]) {
            const d = document.createElement('div');
            d.className = 'dato';
            const b = document.createElement('b'); b.textContent = n;
            const s = document.createElement('span'); s.textContent = t;
            d.append(b, s); res.append(d);
        }
    },

    _pintarListas() {
        const llenar = (id, valores) => {
            const dl = $(id);
            vaciar(dl);
            for (const [v, etiqueta] of valores) {
                const o = document.createElement('option');
                o.value = v; if (etiqueta) o.label = etiqueta;
                dl.append(o);
            }
        };
        const d = this.personas;
        llenar('dl-matriculas', d.filter(x => util(x.matricula)).map(x => [fmtMat(x.matricula), [x.nombre, x.empresa].filter(util).join(' · ')]));
        llenar('dl-nombres', d.filter(x => util(x.nombre)).map(x => [x.nombre, [fmtMat(x.matricula), x.empresa].filter(util).join(' · ')]));
        const unicos = campo => [...new Set(d.map(x => x[campo]).filter(util))].sort().map(v => [v]);
        llenar('dl-empresas', unicos('empresa'));
        llenar('dl-motivos', unicos('motivo'));
    },

    // ── Edición en las tablas ───────────────────────────────────────────
    _buscarRegistro(id) {
        for (const mes of Object.keys(this.meses)) {
            const r = this.meses[mes].find(x => x.id === id);
            if (r) return r;
        }
        return null;
    },

    _editar(e, tabla) {
        const inp = e.target;
        const id = filaDe(inp);
        const campo = inp.dataset.campo;
        if (!id || !campo) return;
        let v = leer(inp);
        if (campo === 'matricula') v = fmtMat(v);
        if (inp.dataset.tipo === 'fecha' && !v) { this.aviso('Esa fecha no se entiende: escríbela como dd/mm/aaaa.', true); this.pintar(); return; }
        const traerDeDatos = f => {
            if (campo !== 'matricula' && campo !== 'nombre') return;
            const p = campo === 'matricula' ? this.porMatricula(v) : this.porNombre(v);
            if (p) for (const c of DE_DATOS) if (c !== campo) f[c] = c === 'matricula' ? fmtMat(p.matricula) : p[c] || '';
            return p;
        };
        if (tabla === 'tablaDatos') {
            const p = this.personas.find(x => x.id === id);
            if (!p) return;
            p[campo] = v;
            this._anotar({ t: 'p', id: p.id, p: this._limpioPersona(p) });
        } else if (tabla === 'tablaBorrador') {
            const f = this.borrador.filas.find(x => x.id === id);
            if (!f) return;
            f[campo] = v;
            if (traerDeDatos(f)) { f.revisar = false; f.nota = ''; }
            this.guardar();
        } else {
            const antes = this._buscarRegistro(id);
            if (!antes) return;
            const f = Object.assign({}, antes);
            f[campo] = v;
            traerDeDatos(f);
            this._guardarRegistro(f, antes);
            if (campo === 'fecha' && this.esGestion && v.slice(0, 7) !== this.mes) this.aviso(`Fila movida a ${nombreMes(v.slice(0, 7))}.`);
        }
        this.pintar();
    },

    _limpioPersona(p) {
        const out = { id: p.id, color: p.color || 0 };
        for (const c of CAMPOS_DATOS) out[c] = p[c] || '';
        return out;
    },

    _accion(e, tabla) {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const id = filaDe(b);
        if (tabla === 'tablaDatos') {
            const i = this.personas.findIndex(x => x.id === id);
            if (i < 0) return;
            if (!confirm(`¿Quitar a ${this.personas[i].nombre || this.personas[i].matricula || 'esta persona'} de Datos?`)) return;
            this.personas.splice(i, 1);
            this._anotar({ t: 'pb', id });
        } else if (tabla === 'tablaBorrador') {
            this.borrador.filas = this.borrador.filas.filter(x => x.id !== id);
            this.guardar();
        } else {
            const r = this._buscarRegistro(id);
            if (!r) return;
            if (b.dataset.accion === 'borrar') {
                if (!confirm(`¿Borrar la entrada de ${r.nombre || r.matricula || 'esta persona'}?`)) return;
                const l = this.listado(r.fecha.slice(0, 7));
                l.splice(l.indexOf(r), 1);
                this._anotar({ t: 'b', id, mes: r.fecha.slice(0, 7) });
            } else if (b.dataset.accion === 'salida') {
                this._guardarRegistro(Object.assign({}, r, { salida: ahora() }), r);
            }
        }
        this.pintar();
    },

    filaDatos() {
        const p = { id: nuevoId(), nombre: '', matricula: '', marca: '', empresa: '', motivo: '', color: 0 };
        this.personas.unshift(p);
        $('filtroDatos').value = '';
        this.guardar();
        this.pintarDatos();
        const primero = $('tablaDatos').querySelector('input');
        if (primero) primero.focus();
    },

    // ── Trabajadores (quién usa la app de la garita) ────────────────────
    async cargarTrabajadores() {
        try {
            const r = await fetch(API + '/api/allowlist?app=acceso', { cache: 'no-store' });
            this.trabajadores = r.ok ? await r.json() : [];
        } catch (_) { this.trabajadores = this.trabajadores || []; }
        this._pintarTrabajadores();
    },

    _pintarTrabajadores() {
        const ul = $('listaTrabajadores');
        vaciar(ul);
        const lista = this.trabajadores || [];
        if (!lista.length) { const li = document.createElement('li'); li.textContent = 'Nadie todavía.'; ul.append(li); return; }
        for (const email of lista) {
            const li = document.createElement('li');
            const s = document.createElement('span'); s.textContent = email;
            const b = this._icono('🗑', 'quitar', 'Quitar acceso');
            b.onclick = () => this.bajaTrabajador(email);
            li.append(s, b); ul.append(li);
        }
    },

    async _cambiarTrabajador(metodo, email) {
        const t = await this.token();
        if (!t || t === 'sin-red') { this.aviso('Sin conexión.', true); return; }
        const r = await fetch(API + '/api/allowlist', {
            method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
            body: JSON.stringify({ app: 'acceso', email }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { this.aviso(d.error || 'No se ha podido cambiar', true); return; }
        this.trabajadores = d.emails || [];
        this._pintarTrabajadores();
    },

    async altaTrabajador() {
        const email = $('correoNuevo').value.trim().toLowerCase();
        if (!email) return;
        await this._cambiarTrabajador('POST', email);
        $('correoNuevo').value = '';
    },

    async bajaTrabajador(email) {
        if (!confirm(`¿Quitar el acceso a ${email}?`)) return;
        await this._cambiarTrabajador('DELETE', email);
    },

    // ── Hoja a mano ─────────────────────────────────────────────────────
    anadirFotos(lista) {
        for (const archivo of [...(lista || [])]) this.fotos.push({ archivo, url: URL.createObjectURL(archivo) });
        this._pintarFotos(this.fotos.length - 1);
    },

    _pintarFotos(activa) {
        const caja = $('fotos');
        vaciar(caja);
        this.fotoActiva = activa;
        this.fotos.forEach((f, i) => {
            const fig = document.createElement('figure');
            const img = document.createElement('img');
            img.src = f.url; img.alt = 'Foto ' + (i + 1);
            if (i === activa) img.className = 'activa';
            img.onclick = () => this._pintarFotos(i);
            fig.append(img); caja.append(fig);
        });
        const hay = activa >= 0 && this.fotos[activa];
        $('visor').hidden = !hay;
        $('accionesFoto').hidden = !hay;
        if (hay) $('visorImg').src = this.fotos[activa].url;
    },

    fechaBorrador(inp) {
        this.borrador.fecha = leer(inp);
        this.guardar();
    },

    filaBorrador() {
        const f = { id: nuevoId() };
        for (const c of CAMPOS_LISTADO) f[c] = '';
        this.borrador.filas.push(f);
        this.guardar();
        this.pintarBorrador();
        const inputs = $('tablaBorrador').querySelectorAll('tr:last-child input');
        if (inputs[0]) inputs[0].focus();
    },

    descartarBorrador() {
        if (this.borrador.filas.length && !confirm('¿Descartar las filas de la hoja sin pasarlas al listado?')) return;
        this.borrador.filas = [];
        this.guardar();
        this.pintarBorrador();
    },

    pasarBorrador() {
        const fecha = leer($('fechaHoja'));
        if (!fecha) { this.aviso('Pon la fecha de la hoja (dd/mm/aaaa).', true); return; }
        const vale = f => ['nombre', 'matricula', 'marca', 'empresa'].some(k => util(f[k]));
        const filas = this.borrador.filas.filter(vale);
        const pendientes = this.borrador.filas.filter(f => !vale(f));
        if (!filas.length) { this.aviso('No hay filas que pasar.', true); return; }
        let nuevos = 0;
        for (const f of filas) {
            const fila = { id: nuevoId() };
            for (const c of CAMPOS_LISTADO) fila[c] = f[c] || '';
            fila.fecha = fecha;
            if (this._guardarRegistro(fila, null)) nuevos++;
        }
        // Las que siguen sin nombre ni matrícula se quedan para completarlas
        this.borrador.filas = pendientes;
        this.guardar();
        this.cambiarMes(fecha.slice(0, 7));
        if (!pendientes.length) this.pestana('listado');
        this.aviso(`${filas.length} filas pasadas al listado${nuevos ? `, ${nuevos} personas nuevas en Datos` : ''}`
            + (pendientes.length ? `. Quedan ${pendientes.length} sin nombre ni matrícula por completar.` : '.'));
    },

    // ── Lectura automática (Tesseract, en el propio móvil) ──────────────
    async _tesseract() {
        if (window.Tesseract) return window.Tesseract;
        await new Promise((ok, ko) => {
            const s = document.createElement('script');
            s.src = TESS.script; s.onload = ok;
            s.onerror = () => ko(new Error('No se ha podido descargar el lector. ¿Hay conexión?'));
            document.head.append(s);
        });
        return window.Tesseract;
    },

    async leerFoto() {
        const foto = this.fotos[this.fotoActiva];
        if (!foto) return;
        const btn = $('btnOcr'), estado = $('estadoOcr'), barra = $('progresoOcr');
        btn.disabled = true; barra.hidden = false;
        const progreso = p => { barra.firstElementChild.style.width = Math.round(p * 100) + '%'; };
        let worker;
        try {
            estado.textContent = 'Preparando el lector (la primera vez tarda un poco)…';
            const T = await this._tesseract();
            worker = await T.createWorker('spa', 1, {
                workerPath: TESS.workerPath, corePath: TESS.corePath, langPath: TESS.langPath,
                logger: m => {
                    if (m.status === 'recognizing text') { estado.textContent = 'Leyendo la hoja…'; progreso(m.progress); }
                    else if (m.status) estado.textContent = 'Preparando el lector… ' + (m.progress ? Math.round(m.progress * 100) + '%' : '');
                },
            });
            // Bloque uniforme: la hoja es una tabla y así lee fila a fila
            await worker.setParameters({ tessedit_pageseg_mode: '6' });
            const lienzo = await this._prepararImagen(foto.archivo);
            const res = await worker.recognize(lienzo);
            const { filas, fecha } = this.interpretar(res.data.text || '');
            if (fecha) { poner($('fechaHoja'), fecha); this.borrador.fecha = fecha; }
            this.borrador.filas.push(...filas);
            this.guardar();
            this.pintarBorrador();
            const conocidas = filas.filter(f => !f.revisar).length;
            estado.textContent = filas.length
                ? `${filas.length} filas propuestas (${conocidas} reconocidas en Datos). Revísalas con la foto delante.`
                : 'No se ha reconocido ninguna matrícula. Añade las filas a mano mirando la foto.';
        } catch (e) {
            estado.textContent = 'No se ha podido leer: ' + (e.message || e);
        } finally {
            try { if (worker) await worker.terminate(); } catch (_) {}
            btn.disabled = false; barra.hidden = true; progreso(0);
        }
    },

    // Escala de grises con algo más de contraste, y a un tamaño en el que
    // Tesseract distingue bien los caracteres.
    async _prepararImagen(archivo) {
        let img;
        try { img = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); }
        catch (_) {
            img = await new Promise((ok, ko) => {
                const i = new Image();
                i.onload = () => ok(i);
                i.onerror = () => ko(new Error('No se puede abrir esta imagen (si es HEIC, compártela como JPG).'));
                i.src = URL.createObjectURL(archivo);
            });
        }
        const f = Math.min(2.5, 2600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const p = d.data;
        for (let i = 0; i < p.length; i += 4) {
            const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
            const v = Math.max(0, Math.min(255, (g - 128) * 1.5 + 140));
            p[i] = p[i + 1] = p[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
        return c;
    },

    // Del texto que sale de Tesseract se sacan, línea a línea, la matrícula y
    // las horas; con la matrícula, el resto sale de Datos. Si la matrícula
    // leída no está en Datos pero se parece mucho a una que sí (un carácter
    // de diferencia, o letras y números que se confunden al escribir), se
    // propone esa y la fila queda para revisar.
    interpretar(texto) {
        const filas = [];
        let fecha = '';
        const aDigito = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', J: '1', T: '7', Z: '2', S: '5', B: '8', G: '6', A: '4' };
        const aLetra = { 0: 'D', 1: 'L', 2: 'Z', 4: 'A', 5: 'S', 6: 'G', 7: 'T', 8: 'B' };
        const conocidas = this.personas.map(d => normMat(d.matricula)).filter(m => /^\d{4}[A-Z]{3}$/.test(m));

        for (const linea of texto.split('\n')) {
            const L = sinAcentos(linea).toUpperCase();
            if (!fecha) {
                const m = L.match(/\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2}|\d{4})\b/);
                if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
                    fecha = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${dos(m[2])}-${dos(m[1])}`;
                }
            }
            // Cuatro "cifras" y tres "letras", con o sin guion en medio
            const pm = L.match(/(?:^|[^A-Z0-9])([0-9OQDUILJTZSBGA]{4})\s*[-–—_.·]?\s*([A-Z0-9]{3})(?![A-Z0-9])/);
            let matricula = '', revisar = true, nota = '';
            if (pm) {
                const leida = [...pm[1]].map(ch => aDigito[ch] || ch).join('') + [...pm[2]].map(ch => aLetra[ch] || ch).join('');
                if (/^\d{4}[A-Z]{3}$/.test(leida)) {
                    if (conocidas.includes(leida)) { matricula = leida; revisar = false; }
                    else {
                        const parecida = conocidas.find(k => [...k].filter((ch, i) => ch !== leida[i]).length === 1);
                        matricula = parecida || leida;
                        nota = parecida ? `Leído ${fmtMat(leida)}, parece ${fmtMat(parecida)}` : `Leído ${fmtMat(leida)}: no está en Datos`;
                    }
                }
            }
            // Sin matrícula, se intenta con un nombre de Datos que aparezca entero
            let persona = matricula ? this.porMatricula(matricula) : null;
            if (!matricula) {
                const lin = clave(linea);
                persona = this.personas.find(d => util(d.nombre) && clave(d.nombre).length >= 5 && lin.includes(clave(d.nombre))) || null;
                if (persona) { revisar = true; nota = 'Reconocido por el nombre: comprueba la matrícula'; }
            }
            const horas = [];
            const lh = L.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1');
            const reHora = /(?:^|[^0-9])([01]?\d|2[0-3])\s*[:.,H']\s*([0-5]\d)(?![0-9])/g;
            for (let h = reHora.exec(lh); h; h = reHora.exec(lh)) horas.push(`${dos(h[1])}:${h[2]}`);
            // Una línea con horas es casi seguro una entrada aunque no se haya
            // entendido la matrícula: se deja la fila para completarla a mano.
            if (!matricula && !persona) {
                if (!horas.length) continue;
                nota = 'No se ha entendido la matrícula';
            }

            const fila = { id: nuevoId(), fecha: '', dni: '', obs: '', revisar, nota, leido: linea.trim() };
            for (const c of DE_DATOS) fila[c] = persona ? (c === 'matricula' ? fmtMat(persona.matricula) : persona[c] || '') : '';
            if (!persona) fila.matricula = fmtMat(matricula);
            fila.entrada = horas[0] || '';
            fila.salida = horas[1] || '';
            filas.push(fila);
        }
        return { filas, fecha };
    },

    // ── Cargar un Excel de antes (gestión) ──────────────────────────────
    async cargarExcels(lista) {
        const todos = [];
        for (const archivo of [...(lista || [])]) {
            try {
                const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellStyles: true });
                const hDatos = wb.SheetNames.find(n => /datos/i.test(n));
                const hListado = wb.SheetNames.find(n => /listado/i.test(n)) || (!hDatos ? wb.SheetNames[0] : null);
                const nDatos = hDatos ? this._importarDatos(wb.Sheets[hDatos]) : 0;
                const { nuevas, meses } = hListado ? await this._importarListado(wb.Sheets[hListado]) : { nuevas: 0, meses: [] };
                this.aviso(`${archivo.name}: ${nDatos} personas nuevas en Datos, ${nuevas} entradas${meses.length ? ' (' + meses.map(nombreMes).join(', ') + ')' : ''}. Subiendo…`);
                todos.push(...meses);
            } catch (e) {
                this.aviso(`${archivo.name}: no se ha podido leer (${e.message}).`, true);
            }
        }
        if (todos.length && !todos.includes(this.mes)) this.cambiarMes(todos.sort().pop());
        this.pintar();
        this.sincronizar();
    },

    // Las columnas se buscan por el título, no por la posición
    _columnas(ws) {
        const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        let cab = filas.findIndex((r, i) => i < 20 && r.some(c => /matr/i.test(String(c))));
        if (cab < 0) return null;
        const t = filas[cab].map(c => clave(c));
        const col = re => t.findIndex(c => re.test(c));
        return {
            cab, filas,
            fecha: col(/^fecha|^dia/), nombre: col(/nombre/), dni: col(/dni/), matricula: col(/matr/),
            marca: col(/marca|modelo|vehic/), empresa: col(/empresa/), entrada: col(/entrada/),
            salida: col(/salida/), motivo: col(/motivo/), obs: col(/observ/),
        };
    },

    _texto(v) { return v == null ? '' : String(v).trim(); },

    _importarDatos(ws) {
        const c = this._columnas(ws);
        if (!c) return 0;
        const colores = { 3: 7, 9: 8, 8: 10 };   // tema del relleno → estilo de la plantilla
        let n = 0;
        c.filas.slice(c.cab + 1).forEach((r, i) => {
            const d = { id: nuevoId(), color: 0 };
            for (const k of CAMPOS_DATOS) d[k] = c[k] >= 0 ? this._texto(r[c[k]]) : '';
            if (!util(d.nombre) && !util(d.matricula)) return;
            d.matricula = fmtMat(d.matricula);
            const celda = ws[XLSX.utils.encode_cell({ r: c.cab + 1 + i, c: Math.max(c.nombre, 0) })];
            const estilo = celda && celda.s;
            const tema = estilo && estilo.fgColor ? estilo.fgColor.theme : null;
            if (estilo && estilo.patternType === 'solid' && colores[tema]) d.color = colores[tema];
            const ya = util(d.matricula) ? this.porMatricula(d.matricula) : this.porNombre(d.nombre);
            if (ya) {
                if (!ya.color && d.color) { ya.color = d.color; this._anotar({ t: 'p', id: ya.id, p: this._limpioPersona(ya) }); }
                return;
            }
            this.personas.push(d);
            this._anotar({ t: 'p', id: d.id, p: this._limpioPersona(d) });
            n++;
        });
        return n;
    },

    async _importarListado(ws) {
        const c = this._columnas(ws);
        if (!c) return { nuevas: 0, meses: [] };
        let fecha = '';
        const porMes = {};
        for (const r of c.filas.slice(c.cab + 1)) {
            const v = k => c[k] >= 0 ? r[c[k]] : '';
            const f = this._leerFecha(v('fecha'));
            if (f) fecha = f;   // la fecha va solo en la primera fila del día
            const fila = { id: nuevoId(), fecha };
            for (const k of CAMPOS_LISTADO) if (k !== 'fecha') fila[k] = this._texto(v(k));
            // Hay quien entra sin nombre ni matrícula apuntados («-») pero con
            // empresa o vehículo: esa fila también cuenta.
            if (!['nombre', 'matricula', 'marca', 'empresa'].some(k => util(fila[k]))) continue;
            if (!fecha) continue;
            fila.matricula = fmtMat(fila.matricula);
            // Lo que no es una hora («-», «no salió»…) se deja como está
            fila.entrada = this._leerHora(v('entrada')) || fila.entrada;
            fila.salida = this._leerHora(v('salida')) || fila.salida;
            (porMes[fecha.slice(0, 7)] = porMes[fecha.slice(0, 7)] || []).push(fila);
        }
        let nuevas = 0;
        for (const mes of Object.keys(porMes)) {
            // Lo que ya hay en el servidor, para no duplicar si se carga dos veces
            let l;
            try { l = await this.cargarMes(mes); } catch (_) { l = this.listado(mes); }
            const igual = (x, f) => x.fecha === f.fecha && x.entrada === f.entrada && normMat(x.matricula) === normMat(f.matricula) && clave(x.nombre) === clave(f.nombre);
            for (const fila of porMes[mes]) {
                if (l.some(x => igual(x, fila))) continue;
                const r = { id: fila.id, origen: 'excel' };
                for (const k of CAMPOS_LISTADO) r[k] = fila[k];
                r.autor = '';
                l.push(Object.assign({}, r, { _pendiente: true }));
                this._registrarLocal(r);
                this.pendientes.push({ t: 'g', id: r.id, r });
                nuevas++;
            }
        }
        this.guardar();
        return { nuevas, meses: Object.keys(porMes).sort() };
    },

    _leerFecha(v) {
        if (typeof v === 'number' && v > 59) {
            const p = XLSX.SSF.parse_date_code(v);
            return p ? `${p.y}-${dos(p.m)}-${dos(p.d)}` : '';
        }
        if (v instanceof Date) return `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
        const s = String(v || '').trim();
        let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${dos(m[2])}-${dos(m[1])}`;
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    },

    _leerHora(v) {
        if (typeof v === 'number' && v >= 0 && v < 1) {
            const min = Math.round(v * 1440);
            return `${dos(Math.floor(min / 60) % 24)}:${dos(min % 60)}`;
        }
        const m = String(v || '').match(/(\d{1,2})[:.,h](\d{2})/);
        return m ? `${dos(m[1])}:${m[2]}` : '';
    },

    // ── Excel (sobre la plantilla de siempre) ───────────────────────────
    _nombreArchivo() {
        const mes = MESES[+this.mes.split('-')[1] - 1];
        return `Control acceso - ${mes[0].toUpperCase()}${mes.slice(1)}.xlsm`;
    },

    // Estilos de la plantilla (xl/styles.xml): 1 celda normal, 6 fecha en
    // negrita, 11 hora; 9, 12 y 13 lo mismo con la raya de fin de día.
    // En Datos, 7, 8 y 10 son los colores de relleno.
    _celda(ref, estilo, valor, tipo) {
        if (valor === '' || valor == null) return `<c r="${ref}" s="${estilo}"/>`;
        if (tipo === 'n') return `<c r="${ref}" s="${estilo}"><v>${valor}</v></c>`;
        return `<c r="${ref}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escXml(valor)}</t></is></c>`;
    },

    _serialFecha(iso) {
        const [a, m, d] = iso.split('-').map(Number);
        return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
    },

    _serialHora(hhmm) {
        if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return null;
        const [h, m] = hhmm.split(':').map(Number);
        return (h * 60 + m) / 1440;
    },

    _filasDatos() {
        const letras = ['A', 'B', 'C', 'D', 'E'];
        return this.personas.map((d, i) => {
            const r = i + 2, s = d.color || 1;
            const celdas = CAMPOS_DATOS.map((c, j) => this._celda(letras[j] + r, s, c === 'matricula' ? fmtMat(d[c]) : d[c]));
            return `<row r="${r}" spans="1:6" ht="21" customHeight="1">${celdas.join('')}</row>`;
        });
    },

    _filasListado() {
        const filas = this._ordenar(this.listado());
        const letras = 'ABCDEFGHIJ';
        return filas.map((f, i) => {
            const r = i + 2;
            const primera = i === 0 || filas[i - 1].fecha !== f.fecha;
            const ultima = i === filas.length - 1 || filas[i + 1].fecha !== f.fecha;
            const celdas = CAMPOS_LISTADO.map((c, j) => {
                const ref = letras[j] + r;
                if (c === 'fecha') return this._celda(ref, ultima ? 12 : 6, primera ? this._serialFecha(f.fecha) : '', 'n');
                if (c === 'entrada' || c === 'salida') {
                    const n = this._serialHora(f[c]);
                    return n == null ? this._celda(ref, ultima ? 9 : 1, f[c]) : this._celda(ref, ultima ? 13 : 11, n, 'n');
                }
                return this._celda(ref, ultima ? 9 : 1, c === 'matricula' ? fmtMat(f[c]) : f[c]);
            });
            return `<row r="${r}" spans="1:11" ht="21" customHeight="1">${celdas.join('')}</row>`;
        });
    },

    _meterFilas(xml, filas, ultimaCol) {
        const i = xml.indexOf('<sheetData>'), j = xml.indexOf('</sheetData>');
        const cab = xml.slice(i + '<sheetData>'.length, j).match(/<row r="1"[\s\S]*?<\/row>/)[0];
        const dim = `A1:${ultimaCol}${Math.max(filas.length + 1, 1)}`;
        return (xml.slice(0, i) + '<sheetData>' + cab + filas.join('') + xml.slice(j))
            .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${dim}"/>`);
    },

    async descargarExcel() {
        try {
            const r = await fetch('plantilla.xlsm', { cache: 'no-cache' });
            if (!r.ok) throw new Error('no se encuentra la plantilla');
            const zip = XLSX.CFB.read(new Uint8Array(await r.arrayBuffer()), { type: 'array' });
            // Las rutas dentro del zip van con la barra delante
            const leerZip = ruta => new TextDecoder().decode(XLSX.CFB.find(zip, '/' + ruta).content);
            const escribir = (ruta, texto) => { XLSX.CFB.find(zip, '/' + ruta).content = new TextEncoder().encode(texto); };
            // sheet1 es Datos y sheet2 es Listado (la que lleva la macro)
            escribir('xl/worksheets/sheet1.xml', this._meterFilas(leerZip('xl/worksheets/sheet1.xml'), this._filasDatos(), 'E'));
            escribir('xl/worksheets/sheet2.xml', this._meterFilas(leerZip('xl/worksheets/sheet2.xml'), this._filasListado(), 'J'));
            const bytes = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
            const nombre = this._nombreArchivo();
            // En la app del móvil no hay descargas del navegador: el archivo
            // va a Descargas por el puente nativo.
            if (window.AndroidBridge && window.AndroidBridge.saveFileBase64) {
                let bin = '';
                const u8 = new Uint8Array(bytes);
                for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
                window.AndroidBridge.saveFileBase64(btoa(bin), nombre);
                return;
            }
            const blob = new Blob([bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = nombre;
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        } catch (e) {
            this.aviso('No se ha podido crear el Excel: ' + (e.message || e), true);
        }
    },

    // ── Versión nueva de la app ─────────────────────────────────────────
    async _buscarVersion() {
        const n = parseInt(String(VERSION).replace(/\D/g, ''), 10);
        if (!NATIVA || !n) return;
        try {
            const r = await fetch(REPO_API);
            if (!r.ok) return;
            const lista = await r.json();
            const re = new RegExp('^' + PREFIJO_RELEASE.replace(/[-]/g, '\\-') + '(\\d+)$');
            let mejor = null;
            for (const rel of lista) {
                const m = re.exec(rel.tag_name || '');
                if (m && +m[1] > n && (!mejor || +m[1] > mejor.n)) {
                    const apk = (rel.assets || []).find(a => /\.apk$/.test(a.name));
                    if (apk) mejor = { n: +m[1], url: apk.browser_download_url };
                }
            }
            if (!mejor) return;
            this._urlApk = mejor.url;
            $('textoVersion').textContent = 'Hay una versión nueva de la app.';
            $('avisoVersion').hidden = false;
        } catch (_) { /* sin red: ya se mirará */ }
    },

    actualizar() {
        if (!this._urlApk) return;
        if (window.AndroidBridge && window.AndroidBridge.downloadAndInstallApk) {
            $('textoVersion').textContent = 'Descargando… 0%';
            window.AndroidBridge.downloadAndInstallApk(this._urlApk);
        } else {
            location.href = this._urlApk;
        }
    },

    _onUpdateProgress(p) { $('textoVersion').textContent = `Descargando… ${p}%`; },
    _onUpdateError() { $('textoVersion').textContent = 'No se ha podido descargar. Vuelve a probar.'; },

    // ── Avisos ──────────────────────────────────────────────────────────
    aviso(texto, error = false) {
        const t = $('toast');
        t.textContent = texto;
        t.className = 'toast' + (error ? ' error' : '');
        t.hidden = false;
        clearTimeout(this._tAviso);
        this._tAviso = setTimeout(() => { t.hidden = true; }, 4500);
    },
};

window.ca = ca;
// La parte nativa del móvil llama a «app» (como en las otras aplicaciones)
window.app = ca;
ca.iniciar();
