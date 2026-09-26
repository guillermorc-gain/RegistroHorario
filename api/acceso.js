import { revisarToken, tokenDe, esGestor } from './_auth.js';

// Control de acceso: lo que los trabajadores apuntan en la garita (quién entra
// y sale del recinto) y el fichero de personas conocidas (Datos). Lo escribe
// la app del trabajador y lo revisa la de gestión, así que vive aquí y no en
// el móvil de cada uno.
//
// Igual que el resto: con Supabase configurado, cada registro es una fila y
// nadie pisa a nadie; sin él, un JSON por mes en la rama de datos del repo,
// con reintento si dos escriben a la vez.

const URL_BASE = process.env.SUPABASE_URL || '';
const CLAVE_DB = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hayBase  = () => !!(URL_BASE && CLAVE_DB);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
const RAMA         = 'datos';
const LISTA        = 'allowed-users-acceso.json';

const CAMPOS = ['fecha', 'nombre', 'dni', 'matricula', 'marca', 'empresa', 'entrada', 'salida', 'motivo', 'obs'];
const CAMPOS_PERSONA = ['nombre', 'matricula', 'marca', 'empresa', 'motivo'];
// Un trabajador corrige lo de la garita de hoy y de ayer (la salida de
// alguien que entró en el turno anterior, por ejemplo); lo de antes ya es
// cosa de gestión.
const DIAS_EDITABLES = 2;
const MAX_POR_PETICION = 500;

// ── Utilidades ──────────────────────────────────────────────────────────────
const texto = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
const normMat = m => String(m || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clave = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const util = v => { const s = String(v || '').trim(); return s && s !== '-' ? s : ''; };
const fmtMat = m => {
  const n = normMat(m);
  return /^\d{4}[A-Z]{3}$/.test(n) ? n.slice(0, 4) + '-' + n.slice(4) : texto(m, 20).toUpperCase();
};
const idValido = id => /^[A-Za-z0-9_-]{6,40}$/.test(String(id || ''));
const mesValido = m => /^\d{4}-\d{2}$/.test(String(m || ''));

function limpiarRegistro(r) {
  const out = {};
  for (const c of CAMPOS) out[c] = texto(r[c], c === 'obs' ? 300 : 120);
  out.matricula = fmtMat(out.matricula);
  return out;
}

function limpiarPersona(p) {
  const out = { id: p.id, color: [0, 7, 8, 10].includes(p.color) ? p.color : 0 };
  for (const c of CAMPOS_PERSONA) out[c] = texto(p[c]);
  out.matricula = fmtMat(out.matricula);
  return out;
}

function diasDesde(fechaIso) {
  const hoy = new Date();
  const [a, m, d] = fechaIso.split('-').map(Number);
  return Math.floor((Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - Date.UTC(a, m - 1, d)) / 86400000);
}

const nuevoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ── Quién puede entrar ──────────────────────────────────────────────────────
let listaCache = { emails: null, hasta: 0 };
async function listaAcceso() {
  if (listaCache.emails && Date.now() < listaCache.hasta) return listaCache.emails;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${LISTA}?ref=${RAMA}`, { headers: gh() });
    if (r.status === 404) { listaCache = { emails: [], hasta: Date.now() + 60000 }; return []; }
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    const emails = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
    listaCache = { emails: (Array.isArray(emails) ? emails : []).map(e => String(e).toLowerCase().trim()), hasta: Date.now() + 60000 };
  } catch (_) {
    if (!listaCache.emails) return [];
    listaCache.hasta = Date.now() + 15000;
  }
  return listaCache.emails;
}

// ── Almacén: Supabase ───────────────────────────────────────────────────────
async function db(ruta, opciones = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    ...opciones,
    headers: { apikey: CLAVE_DB, Authorization: `Bearer ${CLAVE_DB}`, 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Base de datos ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const baseDatos = {
  async registros(mes) {
    const filas = await db(`acceso_registros?select=datos&mes=eq.${mes}`);
    return (filas || []).map(f => f.datos);
  },
  async guardarRegistros(lista) {
    if (!lista.length) return;
    await db('acceso_registros', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(lista.map(r => ({ id: r.id, mes: r.fecha.slice(0, 7), datos: r, actualizado: new Date().toISOString() }))),
    });
  },
  async borrarRegistros(ids) {
    if (!ids.length) return;
    await db(`acceso_registros?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
  },
  async personas() {
    const filas = await db('acceso_personas?select=datos&order=creado.asc');
    return (filas || []).map(f => f.datos);
  },
  async guardarPersonas(lista) {
    if (!lista.length) return;
    await db('acceso_personas', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(lista.map(p => ({ id: p.id, datos: p, ...(p.creado ? { creado: p.creado } : {}) }))),
    });
  },
  async borrarPersonas(ids) {
    if (!ids.length) return;
    await db(`acceso_personas?id=in.(${ids.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
  },
};

// ── Almacén: rama de datos del repo ─────────────────────────────────────────
function gh() {
  return {
    'User-Agent': 'horasemt-app', Accept: 'application/vnd.github+json',
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
}

async function leerJson(ruta) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ruta}?ref=${RAMA}&t=${Date.now()}`,
    { headers: { ...gh(), 'Cache-Control': 'no-cache' }, cache: 'no-store' });
  if (r.status === 404) return { datos: null, sha: null };
  if (!r.ok) throw new Error(`GitHub ${r.status} al leer ${ruta}`);
  const meta = await r.json();
  let contenido = meta.content ? Buffer.from(meta.content, 'base64').toString('utf8') : '';
  // Pasado 1 MB la API no manda el contenido: se pide en bruto
  if (!contenido && meta.size) {
    const rr = await fetch(meta.url, { headers: { ...gh(), Accept: 'application/vnd.github.raw' }, cache: 'no-store' });
    if (!rr.ok) throw new Error(`GitHub ${rr.status} al leer ${ruta} entero`);
    contenido = await rr.text();
  }
  return { datos: contenido.trim() ? JSON.parse(contenido) : null, sha: meta.sha };
}

// Lee, cambia y escribe; si otro escribió entre medias (409/422), vuelve a
// empezar con lo último. Así dos garitas apuntando a la vez no se pisan.
async function modificarJson(ruta, cambiar, mensaje) {
  for (let intento = 0; intento < 4; intento++) {
    const { datos, sha } = await leerJson(ruta);
    const nuevo = cambiar(datos);
    const body = {
      message: mensaje, branch: RAMA,
      content: Buffer.from(JSON.stringify(nuevo, null, 1) + '\n').toString('base64'),
      ...(sha ? { sha } : {}),
    };
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${ruta}`,
      { method: 'PUT', headers: { ...gh(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return nuevo;
    if (r.status !== 409 && r.status !== 422) throw new Error(`GitHub ${r.status} al guardar ${ruta}`);
    await new Promise(ok => setTimeout(ok, 300 + Math.random() * 700));
  }
  throw new Error('Demasiadas escrituras a la vez; vuelve a intentarlo');
}

const rutaMes = mes => `acceso/registros-${mes}.json`;
const RUTA_PERSONAS = 'acceso/personas.json';

const repo = {
  async registros(mes) {
    const { datos } = await leerJson(rutaMes(mes));
    return Object.values(datos || {});
  },
  async guardarRegistros(lista) {
    const porMes = {};
    for (const r of lista) (porMes[r.fecha.slice(0, 7)] = porMes[r.fecha.slice(0, 7)] || []).push(r);
    for (const [mes, filas] of Object.entries(porMes)) {
      await modificarJson(rutaMes(mes), d => {
        const o = d || {};
        for (const f of filas) o[f.id] = f;
        return o;
      }, `Control de acceso: ${filas.length} registro(s) de ${mes}`);
    }
  },
  async borrarRegistros(ids, meses) {
    for (const mes of meses) {
      await modificarJson(rutaMes(mes), d => {
        const o = d || {};
        for (const id of ids) delete o[id];
        return o;
      }, `Control de acceso: borrar registro(s) de ${mes}`);
    }
  },
  async personas() {
    const { datos } = await leerJson(RUTA_PERSONAS);
    return Array.isArray(datos) ? datos : [];
  },
  async guardarPersonas(lista) {
    if (!lista.length) return;
    await modificarJson(RUTA_PERSONAS, d => {
      const actuales = Array.isArray(d) ? d : [];
      const porId = new Map(actuales.map(p => [p.id, p]));
      for (const p of lista) porId.set(p.id, { ...(porId.get(p.id) || {}), ...p });
      return [...porId.values()];
    }, 'Control de acceso: personas');
  },
  async borrarPersonas(ids) {
    if (!ids.length) return;
    await modificarJson(RUTA_PERSONAS, d => (Array.isArray(d) ? d : []).filter(p => !ids.includes(p.id)),
      'Control de acceso: quitar personas');
  },
};

const almacen = () => (hayBase() ? baseDatos : repo);

// Quien entra por la garita y no está en Datos se apunta allí, para que la
// próxima vez salga solo al poner la matrícula (lo que hacía la macro).
function nuevasPersonas(personas, registros) {
  const porMat = new Set(personas.map(p => normMat(p.matricula)).filter(Boolean));
  const porNom = new Set(personas.map(p => clave(p.nombre)).filter(n => n && n !== '-'));
  const nuevas = [];
  for (const r of registros) {
    const mat = util(r.matricula) ? normMat(r.matricula) : '';
    const nom = util(r.nombre) ? clave(r.nombre) : '';
    if (!mat && !nom) continue;
    if (mat ? porMat.has(mat) : porNom.has(nom)) continue;
    const p = { id: nuevoId(), creado: new Date().toISOString(), color: 0 };
    for (const c of CAMPOS_PERSONA) p[c] = r[c] || '';
    nuevas.push(p);
    if (mat) porMat.add(mat);
    if (nom) porNom.add(nom);
  }
  return nuevas;
}

// ── Petición ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 'no-store');

  const { email, motivo } = await revisarToken(tokenDe(req));
  if (!email) {
    const codigo = motivo === 'google_no_responde' ? 503 : 401;
    return res.status(codigo).json({ error: 'Sesión no válida. Vuelve a entrar.', motivo });
  }
  const gestor = await esGestor(email);
  if (!gestor && !(await listaAcceso()).includes(email)) {
    return res.status(403).json({ error: `Esta cuenta (${email}) no tiene acceso al control de acceso. Pide al gestor que te dé de alta.`, motivo: 'sin_acceso' });
  }
  const yo = { email, gestor };
  const A = almacen();

  try {
    if (req.method === 'GET') {
      const mes = String(req.query?.mes || '');
      if (!mesValido(mes)) return res.status(400).json({ error: 'Mes no válido' });
      const [registros, personas] = await Promise.all([A.registros(mes), A.personas()]);
      return res.status(200).json({ yo, registros, personas });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const cuerpo = req.body || {};
    const accion = cuerpo.accion;

    if (accion === 'guardar') {
      const entrada = Array.isArray(cuerpo.registros) ? cuerpo.registros.slice(0, MAX_POR_PETICION) : [];
      if (!entrada.length) return res.status(400).json({ error: 'No hay registros' });
      // Lo que ya existe, para respetar quién lo apuntó y los permisos
      const meses = [...new Set(entrada.map(r => String(r.fecha || '').slice(0, 7)).filter(mesValido))];
      const existentes = new Map();
      for (const mes of meses) for (const r of await A.registros(mes)) existentes.set(r.id, r);

      const guardar = [], rechazados = [];
      const ahora = new Date().toISOString();
      for (const bruto of entrada) {
        if (!idValido(bruto.id)) { rechazados.push({ id: bruto.id, motivo: 'id' }); continue; }
        const r = limpiarRegistro(bruto);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) { rechazados.push({ id: bruto.id, motivo: 'fecha' }); continue; }
        if (!['nombre', 'matricula', 'marca', 'empresa'].some(c => util(r[c]))) { rechazados.push({ id: bruto.id, motivo: 'vacio' }); continue; }
        const antes = existentes.get(bruto.id);
        if (!gestor) {
          const dias = diasDesde(antes ? antes.fecha : r.fecha);
          if (dias > DIAS_EDITABLES - 1 || diasDesde(r.fecha) > DIAS_EDITABLES - 1 || diasDesde(r.fecha) < -1) {
            rechazados.push({ id: bruto.id, motivo: 'antiguo' }); continue;
          }
        }
        guardar.push({
          id: bruto.id, ...r,
          autor: antes ? antes.autor : email,
          creado: antes ? antes.creado : ahora,
          modificado: ahora, modificadoPor: email,
          origen: antes ? antes.origen : texto(bruto.origen || (gestor ? 'gestion' : 'garita'), 20),
        });
      }
      // Si un registro cambia de mes (se corrigió la fecha), sale del viejo
      const mover = guardar.filter(r => existentes.has(r.id) && existentes.get(r.id).fecha.slice(0, 7) !== r.fecha.slice(0, 7));
      await A.guardarRegistros(guardar);
      if (mover.length) await A.borrarRegistros(mover.map(r => r.id), [...new Set(mover.map(r => existentes.get(r.id).fecha.slice(0, 7)))]);

      const personas = await A.personas();
      const nuevas = nuevasPersonas(personas, guardar);
      await A.guardarPersonas(nuevas);
      return res.status(200).json({ guardados: guardar.map(r => r.id), rechazados, personasNuevas: nuevas });
    }

    if (accion === 'borrar') {
      const mes = String(cuerpo.mes || '');
      const ids = (Array.isArray(cuerpo.ids) ? cuerpo.ids : []).filter(idValido).slice(0, MAX_POR_PETICION);
      if (!mesValido(mes) || !ids.length) return res.status(400).json({ error: 'Faltan datos' });
      const actuales = new Map((await A.registros(mes)).map(r => [r.id, r]));
      const permitidos = ids.filter(id => {
        const r = actuales.get(id);
        if (!r) return false;
        return gestor || (r.autor === email && diasDesde(r.fecha) <= DIAS_EDITABLES - 1);
      });
      await A.borrarRegistros(permitidos, [mes]);
      return res.status(200).json({ borrados: permitidos });
    }

    // Datos (el fichero de personas) lo cambia gestión
    if (accion === 'personas') {
      if (!gestor) return res.status(403).json({ error: 'Solo gestión puede cambiar Datos' });
      const lista = (Array.isArray(cuerpo.personas) ? cuerpo.personas : [])
        .filter(p => idValido(p.id)).slice(0, 2000).map(limpiarPersona);
      await A.guardarPersonas(lista);
      const borrar = (Array.isArray(cuerpo.borrar) ? cuerpo.borrar : []).filter(idValido);
      await A.borrarPersonas(borrar);
      return res.status(200).json({ guardadas: lista.length, borradas: borrar.length });
    }

    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
