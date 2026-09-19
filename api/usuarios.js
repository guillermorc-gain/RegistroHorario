import { emailDelToken, tokenDe, exigirAdmin } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
const BRANCH       = 'main';
const FILE_PATH    = 'usuarios-resumen.json';
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
const MAX_AVATAR   = 40 * 1024;   // el avatar va reescalado a 80px, no debe pasar de aquí
const MAX_JORNADAS = 500;         // un año da ~220; el tope evita cargas absurdas
const MAX_LUGARES  = 500;         // un lugar por día: más de un año de excepciones

// 'YYYYMMDD' -> lista de días del tramo, ambos incluidos. Se acota a 400 para
// que una petición mal formada no genere un fichero enorme.
function diasEntre(desde, hasta) {
  const ok = f => /^\d{8}$/.test(String(f || ''));
  if (!ok(desde) || !ok(hasta) || hasta < desde) return [];
  const aFecha = f => new Date(+f.slice(0, 4), +f.slice(4, 6) - 1, +f.slice(6, 8), 12);
  const out = [];
  for (let d = aFecha(desde), fin = aFecha(hasta); d <= fin && out.length < 400; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

// Un tramo sin inicio no se puede situar en el calendario; el fin vacío
// significa que sigue de baja.
function limpiarBajas(bajas) {
  if (!Array.isArray(bajas)) return [];
  const ok = f => /^\d{8}$/.test(String(f || ''));
  return bajas
    .filter(b => ok(b?.d) && (!b.h || ok(b.h)) && (!b.h || b.h >= b.d))
    .slice(0, 50)
    .map(b => ({ d: b.d, h: b.h || '' }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

function enBajaHoy(bajas) {
  const hoy = new Date();
  const f = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
  return (bajas || []).some(b => b.d <= f && (!b.h || b.h >= f));
}

function recortarLugares(lugares) {
  const claves = Object.keys(lugares).sort();
  if (claves.length <= MAX_LUGARES) return lugares;
  const recorte = {};
  claves.slice(-MAX_LUGARES).forEach(k => { recorte[k] = lugares[k]; });
  return recorte;
}

const ghHeaders = () => ({
  'User-Agent': 'horasemt-app',
  Accept: 'application/vnd.github+json',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
});

async function getFile() {
  // GitHub responde con ETag y puede servir una copia cacheada; el parámetro
  // suelto y el no-cache fuerzan a que la lectura sea siempre la última.
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

// Dos apps escribiendo a la vez chocan en el sha; reintentar una vez releyendo
// basta cuando cada usuario publica una vez al día.
async function guardarConReintento(mutar, mensaje) {
  for (let intento = 0; intento < 3; intento++) {
    const { data, sha } = await getFile();
    const nuevo = mutar(data);
    const status = await setFile(nuevo, sha, mensaje);
    if (status >= 200 && status < 300) return nuevo;
    if (status !== 409) return null;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, X-Admin-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    // Cada conductor publica su propio resumen
    if (req.method === 'POST') {
      // Cada trabajador escribe su propia fila. El correo sale del token, no de
      // la cabecera, para que nadie pueda escribir en la fila de otro. Las apps
      // antiguas todavía no mandan el token: mientras queden, se acepta la
      // cabecera, pero solo después de haber intentado el token.
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-user-email'] || '').toLowerCase().trim();
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      const b = req.body || {};
      if (typeof b.avatar === 'string' && b.avatar.length > MAX_AVATAR) b.avatar = null;

      const nuevo = await guardarConReintento(data => {
        const previo = data[quien] || {};
        data[quien] = {
          ...previo,
          email: quien,
          nombre:       typeof b.nombre === 'string' ? b.nombre.slice(0, 80) : previo.nombre || '',
          conductor:    typeof b.conductor === 'string' ? b.conductor.slice(0, 12) : previo.conductor || '',
          avatar:       b.avatar ?? previo.avatar ?? null,
          version:      typeof b.version === 'string' ? b.version.slice(0, 20) : previo.version || '',
          horasMes:     Number(b.horasMes) || 0,
          horasTotales: Number(b.horasTotales) || 0,
          horasAnuales: Number(b.horasAnuales) || previo.horasAnuales || 777,
          jornadaHoras: Number(b.jornadaHoras) || previo.jornadaHoras || 7,
          diasMes:      Number(b.diasMes) || 0,
          turno:        ['M','T','N'].includes(b.turno) ? b.turno : (previo.turno || ''),
          horaInicio:   typeof b.horaInicio === 'string' ? b.horaInicio.slice(0, 5) : previo.horaInicio || '',
          horaFin:      typeof b.horaFin === 'string' ? b.horaFin.slice(0, 5) : previo.horaFin || '',
          horarioDe:    b.horarioDe === 'hoy' ? 'hoy' : 'anterior',
          jornadas:     Array.isArray(b.jornadas) ? b.jornadas.slice(-MAX_JORNADAS) : (previo.jornadas || []),
          // el puesto lo pone el gestor: una publicación del conductor no lo pisa
          puesto:       previo.puesto || '',
          actualizado:  new Date().toISOString(),
        };
        return data;
      }, `Resumen de ${quien}`);

      return nuevo ? res.status(200).json(nuevo[quien]) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    // Solo el gestor asigna el puesto de trabajo
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      if (!await exigirAdmin(req, res, ADMIN_EMAIL)) return;
      const { email, puesto, ficticio, baja, bajas, desde, hasta } = req.body || {};
      const clave = (email || '').toLowerCase().trim();
      if (!clave) return res.status(400).json({ error: 'Falta el email' });
      // Los usuarios de prueba solo pueden vivir bajo este dominio, para que no
      // se pueda sobrescribir a un trabajador real con datos inventados.
      if (ficticio && !clave.endsWith('@prueba.local')) {
        return res.status(400).json({ error: 'Los usuarios de prueba usan @prueba.local' });
      }

      const nuevo = await guardarConReintento(data => {
        if (req.method === 'DELETE') delete data[clave];
        else if (ficticio) {
          data[clave] = {
            ...ficticio,
            email: clave,
            ficticio: true,
            jornadas: Array.isArray(ficticio.jornadas) ? ficticio.jornadas.slice(-MAX_JORNADAS) : [],
            actualizado: new Date().toISOString(),
          };
        }
        // La baja (BE) y el lugar de trabajo son campos del gestor; una
        // publicación del trabajador los conserva porque no los sobrescribe.
        else if (data[clave] && bajas !== undefined) {
          // Tramos de baja con fecha. `baja` se sigue guardando porque es lo
          // que mira la lista para pintar en gris, y sale de los tramos.
          data[clave].bajas = limpiarBajas(bajas);
          data[clave].baja  = enBajaHoy(data[clave].bajas);
        }
        else if (data[clave] && baja !== undefined) data[clave].baja = !!baja;
        // Lugar solo para unas fechas: va aparte de `puesto` porque la app del
        // trabajador reescribe sus jornadas enteras cada vez que publica y se
        // llevaría por delante el cambio.
        else if (data[clave] && desde && hasta) {
          const lugares = { ...(data[clave].lugares || {}) };
          for (const f of diasEntre(desde, hasta)) {
            if (puesto) lugares[f] = String(puesto).slice(0, 40);
            else delete lugares[f];
          }
          data[clave].lugares = recortarLugares(lugares);
        }
        // Sin fechas es el lugar habitual: manda sobre cualquier excepción
        else if (data[clave]) {
          data[clave].puesto  = String(puesto || '').slice(0, 40);
          data[clave].lugares = {};
        }
        return data;
      }, req.method === 'DELETE' ? `Quitar ${clave}`
         : ficticio ? `Usuario de prueba ${clave}`
         : baja !== undefined ? `${baja ? 'Baja' : 'Alta'} de ${clave}`
         : bajas !== undefined ? `Bajas de ${clave}`
         : desde && hasta ? `Lugar de ${clave} del ${desde} al ${hasta}`
         : `Lugar de ${clave}`);

      return nuevo ? res.status(200).json(nuevo) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
