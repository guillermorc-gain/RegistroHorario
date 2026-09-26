// Control de acceso: el Excel de siempre, pero rellenado desde el móvil.
//
// Datos es el fichero de las personas que entran (nombre, matrícula, vehículo,
// empresa y motivo), el mismo para todos los meses. Listado es lo que se apunta
// cada día. Igual que la macro del Excel, al escribir en el listado una
// matrícula o un nombre que ya está en Datos se rellena el resto; y quien no
// está se guarda en Datos para la próxima vez.
//
// Las hojas escritas a mano se pasan con la foto delante. La lectura
// automática es Tesseract, que es gratis y funciona en el propio navegador: la
// foto no sale del móvil. Con letra a mano falla bastante, así que solo
// propone filas (sobre todo matrículas y horas) y cada una se revisa.
//
// El Excel que se descarga se hace sobre la plantilla de siempre (con su macro
// y su formato): solo se cambian las filas.
//
// Todo se guarda en este navegador.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CLAVE = 'controlAcceso.v2';
const CAMPOS_DATOS = ['nombre', 'matricula', 'marca', 'empresa', 'motivo'];
const CAMPOS_LISTADO = ['fecha', 'nombre', 'dni', 'matricula', 'marca', 'empresa', 'entrada', 'salida', 'motivo', 'obs'];
// Lo que se trae de Datos al reconocer a alguien (lo que rellenaba la macro)
const DE_DATOS = ['nombre', 'matricula', 'marca', 'empresa', 'motivo'];
// Tesseract se descarga la primera vez que se usa (unos 6 MB) y luego queda
// en la caché del navegador. Versiones fijas para que no cambie solo.
const TESS = {
    script: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int',
};

const $ = id => document.getElementById(id);
const dos = n => String(n).padStart(2, '0');
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
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
const fmtFecha = iso => { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a.slice(2)}`; };
const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control: Excel se niega a abrir el archivo si aparecen
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const ca = {
    estado: { datos: [], meses: {} },
    mes: hoy().slice(0, 7),
    borrador: { fecha: hoy(), filas: [] },
    fotos: [],          // {url, archivo} — solo en memoria

    // ── Arranque y guardado ─────────────────────────────────────────────
    iniciar() {
        try {
            const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
            if (g && Array.isArray(g.datos) && g.meses) this.estado = g;
            const b = JSON.parse(localStorage.getItem(CLAVE + '.borrador') || 'null');
            if (b && Array.isArray(b.filas)) this.borrador = b;
            const m = localStorage.getItem(CLAVE + '.mes');
            if (/^\d{4}-\d{2}$/.test(m || '')) this.mes = m;
        } catch (_) { /* sin almacenamiento: se trabaja en memoria */ }

        const f = $('formEntrada');
        f.fecha.value = this.mes === hoy().slice(0, 7) ? hoy() : this.mes + '-01';
        f.entrada.value = ahora();
        f.matricula.addEventListener('input', () => this._completarForm('matricula'));
        f.nombre.addEventListener('input', () => this._completarForm('nombre'));
        for (const id of ['tablaListado', 'tablaDatos', 'tablaBorrador']) {
            $(id).addEventListener('change', e => this._editar(e, id));
            $(id).addEventListener('click', e => this._accion(e, id));
        }
        $('fechaHoja').value = this.borrador.fecha || hoy();
        this.pintar();
    },

    guardar() {
        try {
            localStorage.setItem(CLAVE, JSON.stringify(this.estado));
            localStorage.setItem(CLAVE + '.borrador', JSON.stringify(this.borrador));
        } catch (_) { this.aviso('No se ha podido guardar en este navegador: descarga el Excel para no perderlo.', true); }
    },

    listado(c = this.mes) {
        if (!this.estado.meses[c]) this.estado.meses[c] = { listado: [] };
        return this.estado.meses[c].listado;
    },

    // ── Mes y pestañas ──────────────────────────────────────────────────
    cambiarMes(valor) {
        if (!/^\d{4}-\d{2}$/.test(valor || '')) return;
        this.mes = valor;
        try { localStorage.setItem(CLAVE + '.mes', valor); } catch (_) {}
        const f = $('formEntrada');
        if (f.fecha.value.slice(0, 7) !== valor) f.fecha.value = valor === hoy().slice(0, 7) ? hoy() : valor + '-01';
        this.pintar();
    },

    moverMes(paso) {
        const [a, m] = this.mes.split('-').map(Number);
        const d = new Date(a, m - 1 + paso, 1);
        this.cambiarMes(`${d.getFullYear()}-${dos(d.getMonth() + 1)}`);
    },

    pestana(nombre) {
        for (const p of ['listado', 'hoja', 'datos', 'excel']) $('p-' + p).hidden = p !== nombre;
        document.querySelectorAll('nav button').forEach(b => b.classList.toggle('activa', b.dataset.pestana === nombre));
    },

    // ── Búsquedas en Datos ──────────────────────────────────────────────
    porMatricula(m) {
        const n = normMat(m);
        if (!n) return null;
        // La última que se apuntó manda, por si alguien cambió de empresa
        for (let i = this.estado.datos.length - 1; i >= 0; i--) {
            if (normMat(this.estado.datos[i].matricula) === n) return this.estado.datos[i];
        }
        return null;
    },

    porNombre(nombre) {
        const k = clave(nombre);
        if (!k || k === '-') return null;
        for (let i = this.estado.datos.length - 1; i >= 0; i--) {
            if (clave(this.estado.datos[i].nombre) === k) return this.estado.datos[i];
        }
        return null;
    },

    // Quien no está en Datos se añade; quien está no se toca (lo que se
    // corrija en Datos se corrige allí, a propósito).
    registrarEnDatos(f) {
        const mat = util(f.matricula), nom = util(f.nombre);
        if (!mat && !nom) return false;
        const ya = mat ? this.porMatricula(mat) : this.porNombre(nom);
        if (ya) return false;
        this.estado.datos.push({
            id: nuevoId(), nombre: f.nombre || '', matricula: mat ? fmtMat(mat) : (f.matricula || ''),
            marca: f.marca || '', empresa: f.empresa || '', motivo: f.motivo || '', color: 0,
        });
        return true;
    },

    // ── Formulario del listado ──────────────────────────────────────────
    _completarForm(desde) {
        const f = $('formEntrada');
        const p = desde === 'matricula' ? this.porMatricula(f.matricula.value) : this.porNombre(f.nombre.value);
        const estado = $('estadoBusqueda');
        for (const campo of DE_DATOS) {
            if (campo === desde) continue;
            const inp = f[campo];
            // Solo se pisa lo que rellenó la búsqueda, no lo escrito a mano
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
        for (const c of CAMPOS_LISTADO) fila[c] = f[c].value.trim();
        if (!fila.fecha) return;
        if (!util(fila.matricula) && !util(fila.nombre)) { this.aviso('Pon al menos la matrícula o el nombre.', true); return; }
        fila.matricula = fmtMat(fila.matricula);
        const nuevo = this.registrarEnDatos(fila);
        this.listado(fila.fecha.slice(0, 7)).push(fila);
        this.guardar();
        if (fila.fecha.slice(0, 7) !== this.mes) this.cambiarMes(fila.fecha.slice(0, 7));
        for (const c of CAMPOS_LISTADO) if (c !== 'fecha') { f[c].value = ''; f[c].classList.remove('auto'); }
        f.entrada.value = ahora();
        $('estadoBusqueda').textContent = '';
        this.pintar();
        this.aviso(nuevo ? 'Añadido al listado y guardado en Datos.' : 'Añadido al listado.');
        f.matricula.focus();
    },

    // ── Pintado ─────────────────────────────────────────────────────────
    pintar() {
        $('mes').value = this.mes;
        const l = this.listado();
        $('nListado').textContent = l.length ? `(${l.length})` : '';
        $('nDatos').textContent = this.estado.datos.length ? `(${this.estado.datos.length})` : '';
        $('nombreExcel').textContent = `«${this._nombreArchivo()}»`;
        this.pintarListado();
        this.pintarDatos();
        this.pintarBorrador();
        this._pintarResumen();
        this._pintarListas();
    },

    _ordenar(filas) {
        return filas.slice().sort((a, b) =>
            (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.entrada || '99').localeCompare(b.entrada || '99'));
    },

    _input(campo, valor) {
        const inp = document.createElement('input');
        inp.dataset.campo = campo;
        inp.type = campo === 'fecha' ? 'date' : campo === 'entrada' || campo === 'salida' ? 'time' : 'text';
        inp.value = valor || '';
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
        tbody.replaceChildren();
        const filas = this._ordenar(this.listado());
        if (!filas.length) { this._vacio(tbody, 11, `El listado de ${nombreMes(this.mes)} está vacío.`); return; }
        filas.forEach((f, i) => {
            const tr = document.createElement('tr');
            tr.dataset.id = f.id;
            const primera = i === 0 || filas[i - 1].fecha !== f.fecha;
            if (i === filas.length - 1 || filas[i + 1].fecha !== f.fecha) tr.className = 'fin-dia';
            for (const c of CAMPOS_LISTADO) {
                const td = document.createElement('td');
                // La fecha se ve solo en la primera fila del día, como en el
                // Excel; para cambiarla se toca el día.
                if (c === 'fecha' && !primera) { td.className = 'dia'; tr.append(td); continue; }
                td.append(this._input(c, f[c]));
                tr.append(td);
            }
            const acc = document.createElement('td');
            acc.className = 'acc';
            if (!f.salida) acc.append(this._icono('⏱', 'salida', 'Poner la hora de salida ahora'));
            acc.append(this._icono('🗑', 'borrar', 'Borrar fila'));
            tr.append(acc);
            tbody.append(tr);
        });
    },

    pintarDatos() {
        const tbody = $('tablaDatos');
        tbody.replaceChildren();
        const q = clave($('filtroDatos').value);
        const qm = normMat($('filtroDatos').value);
        const filas = this.estado.datos.filter(d => !q ||
            CAMPOS_DATOS.some(c => clave(d[c]).includes(q)) || (qm && normMat(d.matricula).includes(qm)));
        if (!filas.length) {
            this._vacio(tbody, 6, this.estado.datos.length ? 'Nada coincide con la búsqueda.'
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
        tbody.replaceChildren();
        if (!this.borrador.filas.length) {
            this._vacio(tbody, 11, 'Sin filas. Añádelas mirando la foto, o prueba la lectura automática.');
            return;
        }
        for (const f of this.borrador.filas) {
            const tr = document.createElement('tr');
            tr.dataset.id = f.id;
            const conocido = util(f.matricula) ? this.porMatricula(f.matricula) : this.porNombre(f.nombre);
            if (!conocido || f.revisar) { tr.className = 'revisar'; tr.title = f.nota || 'No está en Datos: revisa la matrícula'; }
            // Lo que leyó el lector y por qué hay que mirarla, a la vista
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
        res.replaceChildren();
        for (const [n, t] of [[l.length, 'entradas'], [dias, 'días'], [personas, 'personas distintas'], [this.estado.datos.length, 'en Datos']]) {
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
            dl.replaceChildren();
            for (const [v, etiqueta] of valores) {
                const o = document.createElement('option');
                o.value = v; if (etiqueta) o.label = etiqueta;
                dl.append(o);
            }
        };
        const d = this.estado.datos;
        llenar('dl-matriculas', d.filter(x => util(x.matricula)).map(x => [fmtMat(x.matricula), [x.nombre, x.empresa].filter(util).join(' · ')]));
        llenar('dl-nombres', d.filter(x => util(x.nombre)).map(x => [x.nombre, [fmtMat(x.matricula), x.empresa].filter(util).join(' · ')]));
        const unicos = campo => [...new Set(d.map(x => x[campo]).filter(util))].sort().map(v => [v]);
        llenar('dl-empresas', unicos('empresa'));
        llenar('dl-motivos', unicos('motivo'));
    },

    // ── Edición en las tablas ───────────────────────────────────────────
    _coleccion(tabla) {
        if (tabla === 'tablaDatos') return this.estado.datos;
        if (tabla === 'tablaBorrador') return this.borrador.filas;
        return this.listado();
    },

    _editar(e, tabla) {
        const inp = e.target;
        const id = inp.closest('tr')?.dataset.id;
        const lista = this._coleccion(tabla);
        const f = lista.find(x => x.id === id);
        const campo = inp.dataset.campo;
        if (!f || !campo) return;
        let v = inp.value.trim();
        if (campo === 'matricula') v = fmtMat(v);
        f[campo] = v;
        // En el listado y en la hoja, cambiar matrícula o nombre trae el resto
        // de Datos (lo que hacía la macro); en Datos no, que ahí se corrige.
        if (tabla !== 'tablaDatos' && (campo === 'matricula' || campo === 'nombre')) {
            const p = campo === 'matricula' ? this.porMatricula(v) : this.porNombre(v);
            if (p) for (const c of DE_DATOS) if (c !== campo) f[c] = c === 'matricula' ? fmtMat(p.matricula) : p[c] || '';
            if (tabla === 'tablaBorrador' && p) { f.revisar = false; f.nota = ''; }
        }
        if (tabla === 'tablaListado' && campo === 'fecha' && v && v.slice(0, 7) !== this.mes) {
            lista.splice(lista.indexOf(f), 1);
            this.listado(v.slice(0, 7)).push(f);
            this.aviso(`Fila movida a ${nombreMes(v.slice(0, 7))}.`);
        }
        this.guardar();
        this.pintar();
    },

    _accion(e, tabla) {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const id = b.closest('tr')?.dataset.id;
        const lista = this._coleccion(tabla);
        const i = lista.findIndex(x => x.id === id);
        if (i < 0) return;
        if (b.dataset.accion === 'borrar') {
            if (tabla === 'tablaDatos' && !confirm(`¿Quitar a ${lista[i].nombre || lista[i].matricula || 'esta persona'} de Datos?`)) return;
            lista.splice(i, 1);
        } else if (b.dataset.accion === 'salida') {
            lista[i].salida = ahora();
        }
        this.guardar();
        this.pintar();
    },

    filaDatos() {
        this.estado.datos.unshift({ id: nuevoId(), nombre: '', matricula: '', marca: '', empresa: '', motivo: '', color: 0 });
        $('filtroDatos').value = '';
        this.guardar();
        this.pintarDatos();
        $('tablaDatos').querySelector('input')?.focus();
    },

    vaciarMes() {
        const l = this.listado();
        if (!l.length) return;
        if (!confirm(`¿Borrar las ${l.length} entradas del listado de ${nombreMes(this.mes)}?`)) return;
        delete this.estado.meses[this.mes];
        this.guardar();
        this.pintar();
    },

    // ── Hoja a mano ─────────────────────────────────────────────────────
    anadirFotos(lista) {
        for (const archivo of [...(lista || [])]) this.fotos.push({ archivo, url: URL.createObjectURL(archivo) });
        this._pintarFotos(this.fotos.length - 1);
    },

    _pintarFotos(activa) {
        const caja = $('fotos');
        caja.replaceChildren();
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

    fechaBorrador(v) {
        this.borrador.fecha = v;
        this.guardar();
    },

    filaBorrador() {
        const f = { id: nuevoId() };
        for (const c of CAMPOS_LISTADO) f[c] = '';
        this.borrador.filas.push(f);
        this.guardar();
        this.pintarBorrador();
        const inputs = $('tablaBorrador').querySelectorAll('tr:last-child input');
        inputs[0]?.focus();
    },

    descartarBorrador() {
        if (this.borrador.filas.length && !confirm('¿Descartar las filas de la hoja sin pasarlas al listado?')) return;
        this.borrador.filas = [];
        this.guardar();
        this.pintarBorrador();
    },

    pasarBorrador() {
        const fecha = $('fechaHoja').value;
        if (!fecha) { this.aviso('Pon la fecha de la hoja.', true); return; }
        const vale = f => ['nombre', 'matricula', 'marca', 'empresa'].some(k => util(f[k]));
        const filas = this.borrador.filas.filter(vale);
        const pendientes = this.borrador.filas.filter(f => !vale(f));
        if (!filas.length) { this.aviso('No hay filas que pasar.', true); return; }
        let nuevos = 0;
        const destino = this.listado(fecha.slice(0, 7));
        for (const f of filas) {
            const fila = { id: nuevoId() };
            for (const c of CAMPOS_LISTADO) fila[c] = f[c] || '';
            fila.fecha = fecha;
            fila.matricula = fmtMat(fila.matricula);
            if (this.registrarEnDatos(fila)) nuevos++;
            destino.push(fila);
        }
        // Las que siguen sin nombre ni matrícula se quedan para completarlas
        this.borrador.filas = pendientes;
        this.guardar();
        this.cambiarMes(fecha.slice(0, 7));
        if (!pendientes.length) this.pestana('listado');
        this.aviso(`${filas.length} filas pasadas al listado${nuevos ? `, ${nuevos} personas nuevas en Datos` : ''}`
            + (pendientes.length ? `. Quedan ${pendientes.length} sin nombre ni matrícula por completar.` : '.'));
    },

    // ── Lectura automática (Tesseract, en el navegador) ─────────────────
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
            const { data } = await worker.recognize(lienzo);
            const { filas, fecha } = this.interpretar(data.text || '');
            if (fecha) { $('fechaHoja').value = fecha; this.borrador.fecha = fecha; }
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
            try { await worker?.terminate(); } catch (_) {}
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
        const conocidas = this.estado.datos.map(d => normMat(d.matricula)).filter(m => /^\d{4}[A-Z]{3}$/.test(m));

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
                persona = this.estado.datos.find(d => util(d.nombre) && clave(d.nombre).length >= 5 && lin.includes(clave(d.nombre))) || null;
                if (persona) { revisar = true; nota = 'Reconocido por el nombre: comprueba la matrícula'; }
            }
            const horas = [];
            const lh = L.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1');
            for (const h of lh.matchAll(/(?:^|[^0-9])([01]?\d|2[0-3])\s*[:.,H']\s*([0-5]\d)(?![0-9])/g)) horas.push(`${dos(h[1])}:${h[2]}`);
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

    // ── Cargar un Excel de antes ────────────────────────────────────────
    async cargarExcels(lista) {
        const todos = [];
        for (const archivo of [...(lista || [])]) {
            try {
                const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array', cellStyles: true });
                const hDatos = wb.SheetNames.find(n => /datos/i.test(n));
                const hListado = wb.SheetNames.find(n => /listado/i.test(n)) || (!hDatos ? wb.SheetNames[0] : null);
                const nDatos = hDatos ? this._importarDatos(wb.Sheets[hDatos]) : 0;
                const { nuevas, meses } = hListado ? this._importarListado(wb.Sheets[hListado]) : { nuevas: 0, meses: [] };
                this.guardar();
                this.aviso(`${archivo.name}: ${nDatos} personas nuevas en Datos, ${nuevas} entradas${meses.length ? ' (' + meses.map(nombreMes).join(', ') + ')' : ''}.`);
                todos.push(...meses);
            } catch (e) {
                this.aviso(`${archivo.name}: no se ha podido leer (${e.message}).`, true);
            }
        }
        // Se abre el mes más reciente de lo cargado
        if (todos.length && !todos.includes(this.mes)) this.cambiarMes(todos.sort().pop());
        this.pintar();
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
            const tema = celda?.s?.fgColor?.theme;
            if (celda?.s?.patternType === 'solid' && colores[tema]) d.color = colores[tema];
            const ya = util(d.matricula) ? this.porMatricula(d.matricula) : this.porNombre(d.nombre);
            if (ya) { if (!ya.color && d.color) ya.color = d.color; return; }
            this.estado.datos.push(d);
            n++;
        });
        return n;
    },

    _importarListado(ws) {
        const c = this._columnas(ws);
        if (!c) return { nuevas: 0, meses: [] };
        let nuevas = 0, fecha = '';
        const meses = new Set();
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
            const l = this.listado(fecha.slice(0, 7));
            if (l.some(x => x.fecha === fila.fecha && x.entrada === fila.entrada && normMat(x.matricula) === normMat(fila.matricula) && clave(x.nombre) === clave(fila.nombre))) continue;
            l.push(fila);
            this.registrarEnDatos(fila);
            nuevas++; meses.add(fecha.slice(0, 7));
        }
        return { nuevas, meses: [...meses].sort() };
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
        return this.estado.datos.map((d, i) => {
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
            const leer = ruta => new TextDecoder().decode(XLSX.CFB.find(zip, '/' + ruta).content);
            const escribir = (ruta, texto) => { XLSX.CFB.find(zip, '/' + ruta).content = new TextEncoder().encode(texto); };
            // sheet1 es Datos y sheet2 es Listado (la que lleva la macro)
            escribir('xl/worksheets/sheet1.xml', this._meterFilas(leer('xl/worksheets/sheet1.xml'), this._filasDatos(), 'E'));
            escribir('xl/worksheets/sheet2.xml', this._meterFilas(leer('xl/worksheets/sheet2.xml'), this._filasListado(), 'J'));
            const bytes = XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
            const blob = new Blob([bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = this._nombreArchivo();
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        } catch (e) {
            this.aviso('No se ha podido crear el Excel: ' + (e.message || e), true);
        }
    },

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
ca.iniciar();
