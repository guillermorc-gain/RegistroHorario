import { exigirAdmin } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
// Los datos viven fuera de main: cada escritura de las apps era un commit
// que cancelaba el despliegue del código que fuera por medio.
const BRANCH       = 'datos';
const FILE_PATH    = 'cuadrante.json';
// Only the gestor publishes the roster; every driver just reads it.
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
// A data URL costs ~33% more than the raw bytes, and GitHub's contents API
// starts failing around 1 MB of base64, so keep the payload well under it.
const MAX_CHARS    = 700 * 1024;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile() {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: ghHeaders() }
  );
  if (!r.ok) return { data: null, sha: null };
  const meta = await r.json();
  try {
    return { data: JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8')), sha: meta.sha };
  } catch (_) {
    return { data: null, sha: meta.sha };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data || { imagen: null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;

  try {
    const { sha } = await getFile();

    if (req.method === 'DELETE') {
      const payload = { imagen: null, actualizado: new Date().toISOString() };
      const ok = await save(payload, sha);
      return res.status(ok ? 200 : 500).json(ok ? payload : { error: 'No se pudo borrar' });
    }

    const { imagen, nombre } = req.body || {};
    if (typeof imagen !== 'string' || !imagen.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Imagen inválida' });
    }
    if (imagen.length > MAX_CHARS) {
      return res.status(413).json({ error: 'La imagen es demasiado grande' });
    }
    const payload = {
      imagen,
      nombre: (nombre || '').slice(0, 120),
      actualizado: new Date().toISOString(),
      publicadoPor: adminEmail,
    };
    const ok = await save(payload, sha);
    return res.status(ok ? 200 : 500).json(ok ? payload : { error: 'No se pudo guardar' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function save(payload, sha) {
  const content = Buffer.from(JSON.stringify(payload) + '\n').toString('base64');
  const body = { message: 'Actualizar cuadrante', content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.ok;
}
