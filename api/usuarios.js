const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = 'guillermorc-gain/RegistroHorario';
const BRANCH       = 'main';
const FILE_PATH    = 'usuarios-resumen.json';
const ADMIN_EMAIL  = 'g.rioscorrea@gmail.com';
const MAX_AVATAR   = 40 * 1024;   // el avatar va reescalado a 80px, no debe pasar de aquí
const MAX_JORNADAS = 500;         // un año da ~220; el tope evita cargas absurdas

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Email, X-Admin-Email');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data } = await getFile();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    }

    // Cada conductor publica su propio resumen
    if (req.method === 'POST') {
      const quien = (req.headers['x-user-email'] || '').toLowerCase().trim();
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
      const admin = (req.headers['x-admin-email'] || '').toLowerCase();
      if (admin !== ADMIN_EMAIL.toLowerCase()) {
        return res.status(403).json({ error: 'Solo el gestor puede hacer esto' });
      }
      const { email, puesto, ficticio } = req.body || {};
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
        else if (data[clave]) data[clave].puesto = String(puesto || '').slice(0, 40);
        return data;
      }, req.method === 'DELETE' ? `Quitar ${clave}` : (ficticio ? `Usuario de prueba ${clave}` : `Puesto de ${clave}`));

      return nuevo ? res.status(200).json(nuevo) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    return res.status(405).end();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
