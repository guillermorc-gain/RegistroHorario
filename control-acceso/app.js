// Control de acceso: las hojas de entrada se rellenan a mano en la garita y
// luego hay que pasarlas a un Excel por meses. Aquí se hace foto a la hoja, se
// lee (fecha, hora, matrícula, empresa, nombre) y va a la pestaña Datos del mes
// que ponga la hoja. En Listado se escribe una matrícula y, si esa persona ya
// está en Datos, sale sola quién es: lo mismo que hacía la macro del Excel, y
// en el Excel que se descarga lo hacen fórmulas, que no necesitan macros.
//
// Todo se guarda en este navegador. La lectura de las fotos pasa por
// /api/control-acceso, que pide la sesión de la app de gestión.

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const CLAVE = 'controlAcceso.v1';
// Filas de más en el Listado del Excel, con la fórmula ya puesta, para seguir
// apuntando allí sin tener que arrastrar nada.
const FILAS_LIBRES_LISTADO = 300;
// Hasta dónde miran las fórmulas del Listado en Datos: de sobra para un mes,
// y deja sitio a lo que se añada a mano en el propio Excel.
const FIN_DATOS = 5000;
const MAX_LADO = 2400;          // px del lado largo de la foto que se manda
const MAX_ENVIO = 3.3 * 1024 * 1024;

const $ = id => document.getElementById(id);
const dos = n => String(n).padStart(2, '0');
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
const ahora = () => { const d = new Date(); return `${dos(d.getHours())}:${dos(d.getMinutes())}`; };
const normMatricula = m => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const nombreMes = clave => { const [a, m] = clave.split('-'); return `${MESES[+m - 1][0].toUpperCase()}${MESES[+m - 1].slice(1)} ${a}`; };

const ca = {
    estado: { meses: {} },
    mes: hoy().slice(0, 7),
    pestanaActual: 'importar',

    // ── Arranque y guardado ─────────────────────────────────────────────
    iniciar() {
        try {
            const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
            if (g && g.meses) this.estado = g;
        } catch (_) { /* sin almacenamiento: se trabaja en memoria */ }
        try {
            const m = localStorage.getItem(CLAVE + '.mes');
            if (/^\d{4}-\d{2}$/.test(m || '')) this.mes = m;
        } catch (_) {}
        $('tablaDatos').addEventListener('change', e => this._editar(e, 'datos'));
        $('tablaListado').addEventListener('change', e => this._editar(e, 'listado'));
        $('tablaDatos').addEventListener('click', e => this._accion(e, 'datos'));
        $('tablaListado').addEventListener('click', e => this._accion(e, 'listado'));
        $('lFecha').value = hoy();
        $('lHora').value = ahora();
        this.pintar();
        this.pintarSesion();
    },

    guardar() {
        try { localStorage.setItem(CLAVE, JSON.stringify(this.estado)); }
        catch (_) { this.aviso('No se ha podido guardar en este navegador: descarga el Excel para no perderlo.', true); }
    },

    delMes(clave = this.mes) {
        if (!this.estado.meses[clave]) this.estado.meses[clave] = { datos: [], listado: [] };
        return this.estado.meses[clave];
    },

    // ── Mes y pestañas ──────────────────────────────────────────────────
    cambiarMes(valor) {
        if (!/^\d{4}-\d{2}$/.test(valor || '')) return;
        this.mes = valor;
        try { localStorage.setItem(CLAVE + '.mes', valor); } catch (_) {}
        // La fecha por defecto del listado, dentro del mes que se mira
        if ($('lFecha').value.slice(0, 7) !== valor) $('lFecha').value = valor === hoy().slice(0, 7) ? hoy() : valor + '-01';
        this.pintar();
    },

    moverMes(paso) {
        const [a, m] = this.mes.split('-').map(Number);
        const d = new Date(a, m - 1 + paso, 1);
        this.cambiarMes(`${d.getFullYear()}-${dos(d.getMonth() + 1)}`);
    },

    pestana(nombre) {
        this.pestanaActual = nombre;
        for (const p of ['importar', 'datos', 'listado']) $('p-' + p).hidden = p !== nombre;
        document.querySelectorAll('nav button').forEach(b => b.classList.toggle('activa', b.dataset.pestana === nombre));
        if (nombre === 'listado') setTimeout(() => $('lMatricula').focus(), 50);
    },

    // ── Pintado ─────────────────────────────────────────────────────────
    pintar() {
        $('mes').value = this.mes;
        const m = this.delMes();
        $('nDatos').textContent = m.datos.length ? `(${m.datos.length})` : '';
        $('nListado').textContent = m.listado.length ? `(${m.listado.length})` : '';
        $('nombreExcel').textContent = `«${this._nombreArchivo()}»`;
        this.pintarDatos();
        this.pintarListado();
        this._pintarSugerencias();
    },

    _ordenar(filas) {
        return filas.slice().sort((a, b) =>
            (a.fecha || '9999').localeCompare(b.fecha || '9999') || (a.hora || '99').localeCompare(b.hora || '99'));
    },

    pintarDatos() {
        const m = this.delMes();
        const dudosos = m.datos.filter(f => f.dudoso).length;
        const personas = new Set(m.datos.map(f => normMatricula(f.matricula)).filter(Boolean)).size;
        const res = $('resumenDatos');
        res.replaceChildren(
            this._dato(m.datos.length, 'entradas'),
            this._dato(personas, 'matrículas distintas'),
            this._dato(dudosos, 'por revisar'));

        const filtro = $('filtroDatos').value.trim().toLowerCase();
        const filtroMat = normMatricula(filtro);
        const filas = this._ordenar(m.datos).filter(f => !filtro ||
            (filtroMat && normMatricula(f.matricula).includes(filtroMat)) ||
            (f.empresa || '').toLowerCase().includes(filtro) ||
            (f.nombre || '').toLowerCase().includes(filtro));
        this._pintarTabla($('tablaDatos'), filas, true,
            m.datos.length ? 'Nada coincide con la búsqueda.' : `Aún no hay registros de ${nombreMes(this.mes)}. Importa una foto de la hoja.`);
    },

    pintarListado() {
        const m = this.delMes();
        this._pintarTabla($('tablaListado'), this._ordenar(m.listado), false,
            'El listado de este mes está vacío.');
    },

    _dato(num, texto) {
        const d = document.createElement('div');
        d.className = 'dato';
        const b = document.createElement('b'); b.textContent = num;
        const s = document.createElement('span'); s.textContent = texto;
        d.append(b, s);
        return d;
    },

    _pintarTabla(tbody, filas, conRevision, textoVacio) {
        tbody.replaceChildren();
        if (!filas.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6; td.className = 'vacio'; td.textContent = textoVacio;
            tr.append(td); tbody.append(tr);
            return;
        }
        for (const f of filas) {
            const tr = document.createElement('tr');
            tr.dataset.id = f.id;
            if (conRevision && f.dudoso) { tr.className = 'dudoso'; tr.title = f.nota || 'Revisa esta fila'; }
            for (const [campo, tipo] of [['fecha', 'date'], ['hora', 'time'], ['matricula', 'text'], ['empresa', 'text'], ['nombre', 'text']]) {
                const td = document.createElement('td');
                const inp = document.createElement('input');
                inp.type = tipo; inp.value = f[campo] || ''; inp.dataset.campo = campo;
                if (campo === 'matricula') inp.style.textTransform = 'uppercase';
                td.append(inp); tr.append(td);
            }
            const acc = document.createElement('td');
            acc.className = 'acc';
            if (conRevision && f.dudoso) acc.append(this._icono('✓', 'revisar', 'Dar por revisada'));
            acc.append(this._icono('🗑', 'borrar', 'Borrar fila'));
            tr.append(acc);
            tbody.append(tr);
        }
    },

    _icono(txt, accion, titulo) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'icono'; b.textContent = txt; b.title = titulo; b.dataset.accion = accion;
        return b;
    },

    _pintarSugerencias() {
        const dl = $('matriculas');
        dl.replaceChildren();
        for (const [mat, p] of this._directorio()) {
            const o = document.createElement('option');
            o.value = mat;
            o.label = [p.nombre, p.empresa].filter(Boolean).join(' · ');
            dl.append(o);
        }
    },

    // ── Edición en las tablas ───────────────────────────────────────────
    _fila(tipo, id) { return this.delMes()[tipo].find(f => f.id === id); },

    _editar(e, tipo) {
        const inp = e.target;
        const id = inp.closest('tr')?.dataset.id;
        const f = id && this._fila(tipo, id);
        if (!f || !inp.dataset.campo) return;
        let v = inp.value.trim();
        if (inp.dataset.campo === 'matricula') v = normMatricula(v);
        f[inp.dataset.campo] = v;
        // Una fecha de otro mes se lleva la fila a ese mes
        if (inp.dataset.campo === 'fecha' && v && v.slice(0, 7) !== this.mes) {
            const m = this.delMes();
            m[tipo] = m[tipo].filter(x => x !== f);
            this.delMes(v.slice(0, 7))[tipo].push(f);
            this.aviso(`Fila movida a ${nombreMes(v.slice(0, 7))}.`);
        }
        this.guardar();
        this.pintar();
    },

    _accion(e, tipo) {
        const b = e.target.closest('button[data-accion]');
        if (!b) return;
        const id = b.closest('tr')?.dataset.id;
        const m = this.delMes();
        if (b.dataset.accion === 'borrar') {
            m[tipo] = m[tipo].filter(f => f.id !== id);
        } else if (b.dataset.accion === 'revisar') {
            const f = this._fila(tipo, id);
            if (f) { f.dudoso = false; f.nota = ''; }
        }
        this.guardar();
        this.pintar();
    },

    nuevaFilaDatos() {
        const fecha = this.mes === hoy().slice(0, 7) ? hoy() : this.mes + '-01';
        this.delMes().datos.push({ id: nuevoId(), fecha, hora: '', matricula: '', empresa: '', nombre: '', dudoso: false, nota: '' });
        this.guardar();
        $('filtroDatos').value = '';
        this.pintar();
    },

    vaciarMes() {
        const m = this.delMes();
        if (!m.datos.length && !m.listado.length) return;
        if (!confirm(`¿Borrar los ${m.datos.length} registros de Datos y los ${m.listado.length} del Listado de ${nombreMes(this.mes)}?`)) return;
        delete this.estado.meses[this.mes];
        this.guardar();
        this.pintar();
    },

    // ── Listado: quién es por la matrícula ──────────────────────────────
    // La entrada más reciente de cada matrícula en Datos, de todos los meses:
    // si alguien cambia de empresa, vale lo último que se apuntó.
    _directorio() {
        const dir = new Map();
        const todas = [];
        for (const m of Object.values(this.estado.meses)) todas.push(...m.datos);
        for (const f of this._ordenar(todas)) {
            const k = normMatricula(f.matricula);
            if (!k || (!f.nombre && !f.empresa)) continue;
            dir.set(k, { nombre: f.nombre || '', empresa: f.empresa || '' });
        }
        return dir;
    },

    buscarMatricula() {
        const k = normMatricula($('lMatricula').value);
        const aviso = $('avisoBusqueda');
        const p = k && this._directorio().get(k);
        for (const id of ['lEmpresa', 'lNombre']) {
            const inp = $(id);
            // Solo se pisa lo que puso la búsqueda, no lo que se escribió a mano
            if (inp.classList.contains('auto') || !inp.value) {
                inp.value = p ? (id === 'lEmpresa' ? p.empresa : p.nombre) : '';
                inp.classList.toggle('auto', !!p);
            }
        }
        if (!k) { aviso.textContent = ''; aviso.className = 'aviso-busqueda'; }
        else if (p) { aviso.textContent = `✓ ${p.nombre || 'Sin nombre'}${p.empresa ? ' — ' + p.empresa : ''}`; aviso.className = 'aviso-busqueda ok'; }
        else { aviso.textContent = 'Esta matrícula no está en Datos: escribe empresa y nombre.'; aviso.className = 'aviso-busqueda no'; }
    },

    anadirListado() {
        const matricula = normMatricula($('lMatricula').value);
        const fecha = $('lFecha').value;
        if (!matricula || !fecha) return;
        const fila = {
            id: nuevoId(), fecha, hora: $('lHora').value || '', matricula,
            empresa: $('lEmpresa').value.trim(), nombre: $('lNombre').value.trim(),
        };
        this.delMes(fecha.slice(0, 7)).listado.push(fila);
        this.guardar();
        if (fecha.slice(0, 7) !== this.mes) this.cambiarMes(fecha.slice(0, 7));
        for (const id of ['lMatricula', 'lEmpresa', 'lNombre']) { $(id).value = ''; $(id).classList.remove('auto'); }
        $('lHora').value = ahora();
        $('avisoBusqueda').textContent = '';
        this.pintar();
        $('lMatricula').focus();
    },

    // ── Sesión (la de la app de gestión, en este mismo navegador) ───────
    async token() {
        let at, exp, rt;
        try {
            at = localStorage.getItem('gAccessToken');
            exp = parseInt(localStorage.getItem('gTokenExpiry') || '0', 10);
            rt = localStorage.getItem('gRefreshToken');
        } catch (_) { return null; }
        if (at && Date.now() < exp) return at;
        if (!rt) return null;
        try {
            const r = await fetch('/api/auth/refresh', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            if (!r.ok) return null;
            const d = await r.json();
            // Igual que lo guarda la app de gestión, para que las dos se entiendan
            const hasta = Date.now() + (parseInt(d.expires_in, 10) - 60) * 1000;
            localStorage.setItem('gAccessToken', d.access_token);
            localStorage.setItem('gTokenExpiry', String(hasta));
            return d.access_token;
        } catch (_) { return null; }
    },

    async pintarSesion() {
        const s = $('sesion');
        const t = await this.token();
        s.replaceChildren();
        if (t) { s.textContent = 'Sesión de gestión activa: las fotos se pueden leer.'; return; }
        s.append('Para leer fotos hace falta la sesión de gestión: ');
        const a = document.createElement('a');
        a.href = '/gestion/'; a.textContent = 'entra en la app de gestión';
        s.append(a, ' en este navegador y vuelve aquí. Datos, Listado y el Excel funcionan igual sin ella.');
    },

    // ── Leer fotos ──────────────────────────────────────────────────────
    async leerArchivos(lista) {
        const archivos = [...(lista || [])];
        if (!archivos.length) return;
        const token = await this.token();
        if (!token) { this.pintarSesion(); this.aviso('Primero entra en la app de gestión en este navegador.', true); return; }
        const items = archivos.map(a => ({ archivo: a, li: this._itemCola(a.name || 'Foto') }));
        // De una en una: la lectura tarda y así no se pisan ni saturan
        for (const it of items) await this._leerUno(it, token);
    },

    _itemCola(nombre) {
        const li = document.createElement('li');
        const est = document.createElement('span'); est.className = 'est'; est.textContent = '⏳';
        const cuerpo = document.createElement('div');
        const t = document.createElement('div'); t.textContent = nombre;
        const det = document.createElement('div'); det.className = 'det'; det.textContent = 'En espera…';
        cuerpo.append(t, det); li.append(est, cuerpo);
        $('cola').prepend(li);
        return { set: (icono, texto) => { est.textContent = icono; det.textContent = texto; } };
    },

    async _leerUno({ archivo, li }, token) {
        try {
            li.set('⏳', 'Preparando…');
            const { datos, tipo } = await this._preparar(archivo);
            li.set('🔎', 'Leyendo la hoja… (puede tardar un minuto)');
            const r = await fetch('/api/control-acceso', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ datos, tipo, pista: this.mes }),
            });
            const res = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(res.error || 'Error ' + r.status);
            const { nuevas, repetidas, meses, dudosas } = this._incorporar(res);
            const partes = [`${nuevas} filas nuevas`];
            if (dudosas) partes.push(`${dudosas} por revisar`);
            if (repetidas) partes.push(`${repetidas} ya estaban`);
            if (meses.length) partes.push('→ ' + meses.map(nombreMes).join(', '));
            if (res.observaciones) partes.push('· ' + res.observaciones);
            li.set(nuevas || repetidas ? '✅' : '⚠️', partes.join(', '));
            if (meses.length && !meses.includes(this.mes)) this.cambiarMes(meses[0]);
            else this.pintar();
        } catch (e) {
            li.set('❌', e.message || String(e));
        }
    },

    async _preparar(archivo) {
        if (archivo.type === 'application/pdf') {
            if (archivo.size > MAX_ENVIO * 0.75) throw new Error('El PDF pasa de 2,5 MB: mejor haz fotos de cada hoja.');
            return { datos: await this._base64(archivo), tipo: 'application/pdf' };
        }
        let img;
        try {
            img = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
        } catch (_) {
            img = await new Promise((ok, ko) => {
                const i = new Image();
                i.onload = () => ok(i);
                i.onerror = () => ko(new Error('No se puede abrir esta imagen (si es HEIC, compártela como JPG).'));
                i.src = URL.createObjectURL(archivo);
            });
        }
        const w = img.width, h = img.height;
        const f = Math.min(1, MAX_LADO / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * f); c.height = Math.round(h * f);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        for (const q of [0.88, 0.78, 0.65]) {
            const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', q));
            const datos = await this._base64(blob);
            if (datos.length <= MAX_ENVIO) return { datos, tipo: 'image/jpeg' };
        }
        throw new Error('La foto es demasiado pesada incluso reducida.');
    },

    _base64(blob) {
        return new Promise((ok, ko) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result).split(',')[1] || '');
            r.onerror = () => ko(new Error('No se ha podido leer el archivo.'));
            r.readAsDataURL(blob);
        });
    },

    // Cada fila va al mes de su fecha; si no la tiene, al mes que diga la hoja
    // y, si tampoco, al que está abierto. Una misma foto importada dos veces
    // no duplica nada.
    _incorporar(res) {
        const mesHoja = res.mes >= 1 && res.mes <= 12 && res.anio > 2000 ? `${res.anio}-${dos(res.mes)}` : this.mes;
        let nuevas = 0, repetidas = 0, dudosas = 0;
        const meses = new Set();
        for (const r of res.registros || []) {
            const fecha = /^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '') ? r.fecha : '';
            const fila = {
                id: nuevoId(), fecha: fecha || '', hora: /^\d{2}:\d{2}$/.test(r.hora || '') ? r.hora : '',
                matricula: normMatricula(r.matricula), empresa: (r.empresa || '').trim(), nombre: (r.nombre || '').trim(),
                dudoso: !!r.dudoso || !fecha, nota: (r.nota || '') + (fecha ? '' : (r.nota ? ' · ' : '') + 'Sin fecha en la hoja'),
            };
            if (!fila.matricula && !fila.nombre && !fila.empresa) continue;
            const clave = fecha ? fecha.slice(0, 7) : mesHoja;
            if (this._agregarDatos(clave, fila)) { nuevas++; if (fila.dudoso) dudosas++; meses.add(clave); }
            else repetidas++;
        }
        this.guardar();
        return { nuevas, repetidas, dudosas, meses: [...meses].sort() };
    },

    _agregarDatos(clave, fila) {
        const m = this.delMes(clave);
        const k = f => `${f.fecha}|${f.hora}|${normMatricula(f.matricula)}|${(f.nombre || '').toLowerCase()}`;
        if (m.datos.some(f => k(f) === k(fila))) return false;
        m.datos.push(fila);
        return true;
    },

    // ── Cargar un Excel de antes ────────────────────────────────────────
    async cargarExcels(lista) {
        for (const archivo of [...(lista || [])]) {
            try {
                const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
                const mesArchivo = this._mesDelNombre(archivo.name);
                const hojaDatos = wb.SheetNames.find(n => /datos/i.test(n)) || wb.SheetNames[0];
                const hojaListado = wb.SheetNames.find(n => /listado/i.test(n));
                const d = this._importarHoja(wb.Sheets[hojaDatos], 'datos', mesArchivo);
                const l = hojaListado ? this._importarHoja(wb.Sheets[hojaListado], 'listado', mesArchivo) : { nuevas: 0, meses: [] };
                this.guardar();
                const meses = [...new Set([...d.meses, ...l.meses])].sort();
                this.aviso(`${archivo.name}: ${d.nuevas} en Datos, ${l.nuevas} en Listado${meses.length ? ' (' + meses.map(nombreMes).join(', ') + ')' : ''}.`);
                if (meses.length && !meses.includes(this.mes)) this.cambiarMes(meses[meses.length - 1]);
            } catch (e) {
                this.aviso(`${archivo.name}: no se ha podido leer (${e.message}).`, true);
            }
        }
        this.pintar();
    },

    _mesDelNombre(nombre) {
        const n = String(nombre || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const i = MESES.findIndex(m => n.includes(m) || (m === 'septiembre' && n.includes('setiembre')));
        if (i < 0) return '';
        const a = (n.match(/20\d{2}/) || [])[0] || this.mes.slice(0, 4);
        return `${a}-${dos(i + 1)}`;
    },

    _importarHoja(ws, tipo, mesArchivo) {
        const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        let cab = -1;
        for (let i = 0; i < Math.min(filas.length, 20); i++) {
            if (filas[i].some(c => /matr/i.test(String(c)))) { cab = i; break; }
        }
        if (cab < 0) return { nuevas: 0, meses: [] };
        const col = re => filas[cab].findIndex(c => re.test(String(c)));
        const c = {
            fecha: col(/fecha|d[ií]a/i), hora: col(/hora/i), matricula: col(/matr/i),
            empresa: col(/empresa/i), nombre: col(/nombre/i),
        };
        let nuevas = 0;
        const meses = new Set();
        let ultimaFecha = '';
        const m0 = mesArchivo || this.mes;
        for (const f of filas.slice(cab + 1)) {
            const matricula = normMatricula(f[c.matricula]);
            const empresa = c.empresa >= 0 ? String(f[c.empresa] ?? '').trim() : '';
            const nombre = c.nombre >= 0 ? String(f[c.nombre] ?? '').trim() : '';
            if (!matricula && !nombre && !empresa) continue;
            const fecha = (c.fecha >= 0 && this._leerFecha(f[c.fecha], m0)) || ultimaFecha;
            ultimaFecha = fecha;
            const fila = { id: nuevoId(), fecha, hora: c.hora >= 0 ? this._leerHora(f[c.hora]) : '', matricula, empresa, nombre };
            const clave = fecha ? fecha.slice(0, 7) : m0;
            if (tipo === 'datos') {
                Object.assign(fila, { dudoso: false, nota: '' });
                if (this._agregarDatos(clave, fila)) { nuevas++; meses.add(clave); }
            } else {
                const m = this.delMes(clave);
                if (!m.listado.some(x => x.fecha === fila.fecha && x.hora === fila.hora && x.matricula === fila.matricula)) {
                    m.listado.push(fila); nuevas++; meses.add(clave);
                }
            }
        }
        return { nuevas, meses: [...meses] };
    },

    _leerFecha(v, mesRef) {
        if (typeof v === 'number' && v > 59) {
            const p = XLSX.SSF.parse_date_code(v);
            return p ? `${p.y}-${dos(p.m)}-${dos(p.d)}` : '';
        }
        if (typeof v === 'number' && v >= 1 && v <= 31) return `${mesRef}-${dos(Math.floor(v))}`;
        const s = String(v || '').trim();
        let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
        if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${dos(m[2])}-${dos(m[1])}`; }
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 31) return `${mesRef}-${dos(s)}`;
        return '';
    },

    _leerHora(v) {
        if (typeof v === 'number') {
            const min = Math.round((v % 1) * 1440);
            return `${dos(Math.floor(min / 60) % 24)}:${dos(min % 60)}`;
        }
        const m = String(v || '').match(/(\d{1,2})[:.,h](\d{2})/);
        return m ? `${dos(m[1])}:${m[2]}` : '';
    },

    // ── Excel ───────────────────────────────────────────────────────────
    _nombreArchivo() {
        const [a, m] = this.mes.split('-');
        const mes = MESES[+m - 1];
        return `Control acceso - ${mes[0].toUpperCase()}${mes.slice(1)} ${a}.xlsx`;
    },

    // Fechas y horas como números de Excel, no como texto: así se pueden
    // ordenar y filtrar allí. Se calculan a mano en UTC para que la zona
    // horaria del ordenador no mueva ningún día.
    _celdaFecha(iso) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return { t: 's', v: iso || '' };
        const [a, m, d] = iso.split('-').map(Number);
        return { t: 'n', v: (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000, z: 'dd/mm/yyyy' };
    },

    _celdaHora(hhmm) {
        if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return { t: 's', v: hhmm || '' };
        const [h, m] = hhmm.split(':').map(Number);
        return { t: 'n', v: (h * 60 + m) / 1440, z: 'hh:mm' };
    },

    _texto(v) { return { t: 's', v: v == null ? '' : String(v) }; },

    // La última vez que aparece la matrícula en Datos (LOOKUP con 2 y 1/(…)
    // devuelve la última coincidencia sin necesidad de fórmula matricial).
    _formula(col, fila) {
        const r = `Datos!$C$2:$C$${FIN_DATOS}`;
        const d = `Datos!$${col}$2:$${col}$${FIN_DATOS}`;
        return `IF($C${fila}="","",IFERROR(LOOKUP(2,1/(${r}=$C${fila}),${d})&"",""))`;
    },

    _hoja(filas, anchos) {
        const ws = {};
        filas.forEach((fila, r) => fila.forEach((celda, c) => {
            if (celda) ws[XLSX.utils.encode_cell({ r, c })] = celda;
        }));
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length - 1, 0), c: 4 } });
        ws['!cols'] = anchos.map(wch => ({ wch }));
        return ws;
    },

    descargarExcel() {
        const m = this.delMes();
        const cab = ['Fecha', 'Hora', 'Matrícula', 'Empresa', 'Nombre'].map(t => this._texto(t));
        const datos = this._ordenar(m.datos);

        const filasDatos = [cab, ...datos.map(f => [
            this._celdaFecha(f.fecha), this._celdaHora(f.hora), this._texto(normMatricula(f.matricula)),
            this._texto(f.empresa), this._texto(f.nombre)])];
        const wsDatos = this._hoja(filasDatos, [12, 8, 12, 28, 30]);
        wsDatos['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(datos.length, 1), c: 4 } }) };

        // Lo que en Datos saldría para cada matrícula, para saber si la
        // fórmula da lo mismo que se ve en la web o si hay que dejar el valor
        const enDatos = new Map();
        for (const f of datos) enDatos.set(normMatricula(f.matricula), f);

        const listado = this._ordenar(m.listado);
        const filasListado = [cab];
        listado.forEach((f, i) => {
            const n = i + 2;
            const dat = enDatos.get(normMatricula(f.matricula));
            const celda = (col, campo) => dat && (dat[campo] || '') === (f[campo] || '')
                ? { t: 's', v: f[campo] || '', f: this._formula(col, n) }
                : this._texto(f[campo]);
            filasListado.push([this._celdaFecha(f.fecha), this._celdaHora(f.hora), this._texto(normMatricula(f.matricula)),
                celda('D', 'empresa'), celda('E', 'nombre')]);
        });
        for (let i = 0; i < FILAS_LIBRES_LISTADO; i++) {
            const n = filasListado.length + 1;
            filasListado.push([null, null, null, { t: 's', v: '', f: this._formula('D', n) }, { t: 's', v: '', f: this._formula('E', n) }]);
        }
        const wsListado = this._hoja(filasListado, [12, 8, 12, 28, 30]);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsDatos, 'Datos');
        XLSX.utils.book_append_sheet(wb, wsListado, 'Listado');
        XLSX.writeFile(wb, this._nombreArchivo(), { bookType: 'xlsx', compression: true });
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
