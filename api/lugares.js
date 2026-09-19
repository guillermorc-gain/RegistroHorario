// Catálogo de lugares de trabajo: nombre, turnos y ubicación. Lo mantiene el
// gestor y lo leen las dos apps, para que los turnos y las ubicaciones dejen de
// estar escritos a mano en el código de cada una.
import { exigirAdmin } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const BRANCH       = 'datos';
const FILE_PATH    = 'lugares.json';
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
const MAX_LUGARES  = 60;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile() {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' }
  );
  if (!r.ok) return { data: {}, sha: null };
  const meta = await r.json();
  try {
    const parsed = JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
    return { data: parsed && typeof parsed === 'object' ? parsed : {}, sha: meta.sha };
  } catch (_) {
    return { data: {}, sha: meta.sha };
  }
}

async function setFile(data, sha, mensaje) {
  const content = Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64');
  const body = { message: mensaje, content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.status;
}

const clave = n => String(n || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const hora = v => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v) : '');

// Un turno sin horas no sirve para deducir nada, así que se descarta
function limpiarTurnos(turnos) {
  if (!Array.isArray(turnos)) return [];
  return turnos
    .filter(t => ['M', 'T', 'N'].includes(t?.id) && hora(t.desde) && hora(t.hasta))
    .slice(0, 3)
    .map(t => ({ id: t.id, desde: hora(t.desde), hasta: hora(t.hasta) }));
}

// Días de la semana en que se trabaja ahí, 0 domingo a 6 sábado. Sin lista se
// entiende que todos: es lo que había antes de existir este campo.
function limpiarDias(d) {
  if (!Array.isArray(d)) return null;
  const dias = [...new Set(d.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  return dias.length && dias.length < 7 ? dias : null;
}

function limpiarUbicacion(u) {
  if (!u || typeof u !== 'object') return null;
  const lat = Number(u.lat), lng = Number(u.lng);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const radio = Math.min(2000, Math.max(30, Number(u.radio) || 150));
  return { lat, lng, radio };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;

    const { nombre } = req.body || {};
    const k = clave(nombre);
    if (!k) return res.status(400).json({ error: 'Falta el nombre del lugar' });

    for (let intento = 0; intento < 3; intento++) {
      const { data, sha } = await getFile();
      if (req.method === 'DELETE') {
        delete data[k];
      } else {
        if (!data[k] && Object.keys(data).length >= MAX_LUGARES) {
          return res.status(400).json({ error: 'Demasiados lugares' });
        }
        const previo = data[k] || {};
        const b = req.body || {};
        data[k] = {
          nombre:    String(nombre).trim().slice(0, 40),
          turnos:    b.turnos !== undefined ? limpiarTurnos(b.turnos) : (previo.turnos || []),
          ubicacion: b.ubicacion !== undefined ? limpiarUbicacion(b.ubicacion) : (previo.ubicacion || null),
          dias:      b.dias !== undefined ? limpiarDias(b.dias) : (previo.dias || null),
          // Con dos lugares en la misma ubicación gana el de prioridad más alta
          prioridad: b.prioridad !== undefined ? (Number(b.prioridad) || 0) : (previo.prioridad || 0),
        };
      }
      const status = await setFile(data, sha,
        req.method === 'DELETE' ? `Quitar lugar ${k}` : `Lugar ${k}`);
      if (status >= 200 && status < 300) return res.status(200).json(data);
      if (status !== 409) break;
    }
    return res.status(500).json({ error: 'No se pudo guardar' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
