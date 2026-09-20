// Nóminas: lo que cobra cada trabajador cada mes. Lo lleva el gestor y no lo
// ve nadie más, así que aquí se exige ser el gestor también para leer —a
// diferencia de los lugares o el cuadrante, que los leen las dos apps—.
//
// Se guarda por mes y dentro por trabajador:
//   { "202609": { "uno@x.com": { lineas: [...], deducciones: [...], nota } } }
//
// Los datos del trabajo (días, horas, extras, nocturnas) no se guardan aquí:
// salen de las jornadas que ya hay, que es su sitio. Aquí solo van los
// importes, que son lo que el gestor escribe a mano.
import { exigirAdmin } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
const BRANCH       = 'datos';
const FILE_PATH    = 'nominas.json';
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
const MAX_MESES    = 36;      // tres años; más no se mira nunca
const MAX_LINEAS   = 30;
const MAX_TEXTO    = 60;

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

// Por encima de 1 MB la API de contenidos devuelve el fichero vacío en vez de
// fallar, y leerlo como "no hay nada" se lo llevaría por delante al guardar.
async function leerContenido(meta) {
  if (meta.content) return Buffer.from(meta.content, 'base64').toString('utf8');
  if (!meta.size) return '';
  const r = await fetch(meta.url || meta.download_url, {
    headers: { ...ghHeaders(), Accept: 'application/vnd.github.raw' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('No se pudo leer el fichero completo: ' + r.status);
  return r.text();
}

async function getFile() {
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}&t=${Date.now()}`,
    { headers: { ...ghHeaders(), 'Cache-Control': 'no-cache' }, cache: 'no-store' }
  );
  if (r.status === 404) return { data: {}, sha: null };
  if (!r.ok) throw new Error('GitHub ' + r.status + ' al leer ' + FILE_PATH);
  const meta = await r.json();
  const texto = await leerContenido(meta);
  if (!texto.trim()) return { data: {}, sha: meta.sha };
  const parsed = JSON.parse(texto);
  return { data: parsed && typeof parsed === 'object' ? parsed : {}, sha: meta.sha };
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

const texto = t => String(t ?? '').trim().slice(0, MAX_TEXTO);
// Los importes en céntimos redondeados: en euros con decimales se acaban
// arrastrando los 0,1 + 0,2 = 0,30000000000000004 de toda la vida.
const euros = v => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

function limpiarLineas(ls) {
  if (!Array.isArray(ls)) return [];
  return ls
    .filter(l => l && typeof l === 'object' && texto(l.c))
    .slice(0, MAX_LINEAS)
    .map(l => ({ c: texto(l.c), i: euros(l.i) }));
}

function limpiarNomina(n) {
  return {
    lineas:      limpiarLineas(n?.lineas),
    deducciones: limpiarLineas(n?.deducciones),
    nota:        String(n?.nota ?? '').trim().slice(0, 300),
    actualizado: new Date().toISOString(),
  };
}

// Solo los MAX_MESES más recientes, para que el fichero no crezca sin fin
function recortarMeses(data) {
  const meses = Object.keys(data).filter(m => /^\d{6}$/.test(m)).sort();
  if (meses.length <= MAX_MESES) return data;
  const out = {};
  meses.slice(-MAX_MESES).forEach(m => { out[m] = data[m]; });
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Lo que cobra la gente no lo lee nadie más que el gestor
    if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;

    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      // Con ?mes= se devuelve solo ese, que es lo que pinta la pantalla
      const mes = String(req.query?.mes || '');
      if (/^\d{6}$/.test(mes)) return res.status(200).json({ [mes]: data[mes] || {} });
      return res.status(200).json(data);
    }

    const { mes, email } = req.body || {};
    if (!/^\d{6}$/.test(String(mes || ''))) return res.status(400).json({ error: 'Falta el mes' });
    const quien = String(email || '').toLowerCase().trim();
    if (!quien.includes('@')) return res.status(400).json({ error: 'Falta el trabajador' });

    for (let intento = 0; intento < 3; intento++) {
      const { data, sha } = await getFile();
      const delMes = { ...(data[mes] || {}) };
      if (req.method === 'DELETE') delete delMes[quien];
      else delMes[quien] = limpiarNomina(req.body);
      const nuevo = recortarMeses({ ...data, [mes]: delMes });
      const status = await setFile(nuevo, sha,
        req.method === 'DELETE' ? `Quitar nómina de ${quien} (${mes})` : `Nómina de ${quien} (${mes})`);
      if (status >= 200 && status < 300) return res.status(200).json({ [mes]: delMes });
      if (status !== 409) break;
    }
    return res.status(500).json({ error: 'No se pudo guardar' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
