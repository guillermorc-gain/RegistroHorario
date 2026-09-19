import { emailDelToken, tokenDe, exigirAdmin } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const BRANCH       = 'datos';
const FILE_PATH    = 'notas.json';
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
const MAX_TEXTO    = 500;
const MAX_NOTAS    = 400;   // las más viejas se van cayendo
// Un adjunto va como data URL dentro del JSON, así que hay que acotarlo por
// las dos puntas: lo que ocupa uno y lo que ocupan todos juntos.
const MAX_ADJUNTO  = 600 * 1024;
const MAX_ADJUNTOS = 3;
const TOTAL_ADJUNTOS = 12 * 1024 * 1024;

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
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.status;
}

// Dos apps escriben aquí a la vez; con 409 se vuelve a leer y se reintenta.
async function guardarConReintento(mutar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();
    const nuevo = mutar(data);
    if (!nuevo) return null;
    const status = await setFile(nuevo, sha, mensaje);
    if (status >= 200 && status < 300) return nuevo;
    if (status !== 409) return null;
  }
  return null;
}

const texto = t => String(t ?? '').trim().slice(0, MAX_TEXTO);

function limpiarAdjuntos(a) {
  if (!Array.isArray(a)) return [];
  return a
    .filter(x => typeof x?.datos === 'string' && /^data:[\w.+-]+\/[\w.+-]+;base64,/.test(x.datos))
    .filter(x => x.datos.length <= MAX_ADJUNTO)
    .slice(0, MAX_ADJUNTOS)
    .map(x => ({
      nombre: String(x.nombre || 'adjunto').slice(0, 80),
      tipo:   String(x.tipo || '').slice(0, 60),
      datos:  x.datos,
    }));
}

const pesaAdjuntos = n => [...(n.adjuntos || []), ...(n.respuesta?.adjuntos || [])]
  .reduce((s, a) => s + (a.datos?.length || 0), 0);

// Si el fichero se va de tamaño, las notas viejas pierden los adjuntos pero
// conservan el texto: es lo que de verdad hace falta guardar.
function acotarAdjuntos(data) {
  const ids = Object.keys(data);
  let total = ids.reduce((s, id) => s + pesaAdjuntos(data[id]), 0);
  if (total <= TOTAL_ADJUNTOS) return data;
  const out = { ...data };
  for (const id of ids.sort((a, b) => (data[a].creado || '').localeCompare(data[b].creado || ''))) {
    if (total <= TOTAL_ADJUNTOS) break;
    const peso = pesaAdjuntos(out[id]);
    if (!peso) continue;
    out[id] = { ...out[id], adjuntos: [], adjuntosPurgados: true,
                respuesta: out[id].respuesta ? { ...out[id].respuesta, adjuntos: [] } : null };
    total -= peso;
  }
  return out;
}

// Se guardan las MAX_NOTAS más nuevas, y nunca se tira una sin contestar.
function recortar(data) {
  const ids = Object.keys(data);
  if (ids.length <= MAX_NOTAS) return data;
  const orden = ids.sort((a, b) => (data[a].creado || '').localeCompare(data[b].creado || ''));
  const sobran = orden.length - MAX_NOTAS;
  const out = { ...data };
  let quitadas = 0;
  for (const id of orden) {
    if (quitadas >= sobran) break;
    if (out[id].estado === 'pendiente') continue;
    delete out[id];
    quitadas++;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, X-User-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Con ?email= se devuelven solo las suyas, que es lo que pide su app.
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      const quien = String(req.query?.email || '').toLowerCase().trim();
      const notas = Object.values(data)
        .filter(n => !quien || (n.email || '').toLowerCase() === quien)
        .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
      return res.status(200).json(notas);
    }

    // El trabajador escribe las suyas. El correo sale del token; la cabecera
    // solo vale mientras queden apps antiguas sin mandarlo.
    if (req.method === 'POST') {
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-user-email'] || '').toLowerCase().trim();
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      const b = req.body || {};
      const cuerpo = texto(b.texto);
      const adjuntos = limpiarAdjuntos(b.adjuntos);
      if (!cuerpo && !adjuntos.length) return res.status(400).json({ error: 'La nota está vacía' });
      // El gestor puede abrir la conversación él: la nota se guarda a nombre
      // del trabajador, que es quien la verá en su app, pero firmada por él.
      const para = String(b.para || '').toLowerCase().trim();
      const delGestor = !!para;
      // Aquí no vale la cabecera: escribir en nombre de gestión exige el token
      if (delGestor && delToken !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Solo el gestor escribe a un trabajador' });
      }
      // La hora la pone el servidor: así no depende del reloj del móvil
      const creado = new Date().toISOString();
      const id = `${creado.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
      const nueva = {
        id, email: delGestor ? para : quien, creado,
        nombre:    String(b.nombre || '').slice(0, 80),
        conductor: String(b.conductor || '').slice(0, 12),
        texto: cuerpo,
        adjuntos,
        de: delGestor ? 'gestor' : 'trabajador',
        ...(delGestor ? { gestor: String(b.gestor || '').slice(0, 80) } : {}),
        estado: 'pendiente',
        respuesta: null,
      };
      const nuevo = await guardarConReintento(data => acotarAdjuntos(recortar({ ...data, [id]: nueva })),
        delGestor ? `Nota del gestor para ${para}` : `Nota de ${quien}`);
      return nuevo ? res.status(200).json(nueva) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    // Contestar y dar el visto o denegar es cosa del gestor
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;
      const { id, estado, respuesta, gestor } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta la nota' });
      const nuevo = await guardarConReintento(data => {
        if (!data[id]) return null;
        if (req.method === 'DELETE') { const out = { ...data }; delete out[id]; return out; }
        const n = { ...data[id] };
        if (['pendiente', 'ok', 'no'].includes(estado)) n.estado = estado;
        if (respuesta !== undefined) {
          const cuerpo = texto(respuesta);
          const adj = limpiarAdjuntos(req.body?.adjuntos);
          // El trabajador tiene que ver quién le contesta
          n.respuesta = (cuerpo || adj.length)
            ? { texto: cuerpo, adjuntos: adj,
                gestor: String(gestor || '').slice(0, 80), en: new Date().toISOString() }
            : null;
        }
        return acotarAdjuntos({ ...data, [id]: n });
      }, req.method === 'DELETE' ? `Quitar nota ${id}` : `Respuesta a ${id}`);
      if (!nuevo) return res.status(404).json({ error: 'No se pudo actualizar la nota' });
      return res.status(200).json(nuevo[id] || { id, borrada: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
