import { emailDelToken, tokenDe } from './_auth.js';
import { hayBaseDeDatos, leerNotas, leerNota, guardarNota, borrarNota } from './_almacen.js';

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

// GitHub no manda el contenido en esta llamada cuando el fichero pasa de 1 MB:
// responde 200 con content vacío. Sin mirarlo, el fichero entero se leía como
// "no hay nada" y la siguiente escritura se llevaba por delante a todos. Así
// que por encima de ese tamaño se pide el contenido en bruto, y cualquier
// lectura que falle revienta en vez de devolver un vacío que parece legítimo.
async function leerContenido(meta) {
  if (meta.content) return Buffer.from(meta.content, 'base64').toString('utf8');
  if (!meta.size) return '';
  const r = await fetch(meta.download_url || meta.url, {
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
  if (r.status === 404) return { data: {}, sha: null };   // aún no existe
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

const pesaAdjuntos = n => (n.mensajes || [])
  .flatMap(m => m.adjuntos || [])
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
    out[id] = { ...out[id], adjuntosPurgados: true,
                mensajes: (out[id].mensajes || []).map(m => ({ ...m, adjuntos: [] })) };
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
    if (!out[id].archivada && out[id].tipo !== 'companero'
        && out[id].estado === 'pendiente') continue;
    delete out[id];
    quitadas++;
  }
  return out;
}

// Las conversaciones antiguas guardaban un texto y como mucho una respuesta.
// Se leen como lo que son: los dos primeros mensajes del hilo.
function normalizar(nota) {
  if (!nota) return nota;
  if (Array.isArray(nota.mensajes)) return nota;
  const mensajes = [];
  if (nota.texto || nota.adjuntos?.length) {
    mensajes.push({
      de: nota.de === 'gestor' ? 'gestor' : 'trabajador',
      autor: nota.de === 'gestor' ? (nota.gestor || 'Gestión') : (nota.deNombre || nota.nombre || ''),
      texto: nota.texto || '', adjuntos: nota.adjuntos || [], en: nota.creado,
    });
  }
  if (nota.respuesta?.texto || nota.respuesta?.adjuntos?.length) {
    mensajes.push({
      de: 'gestor', autor: nota.respuesta.gestor || 'Gestión',
      texto: nota.respuesta.texto || '', adjuntos: nota.respuesta.adjuntos || [],
      en: nota.respuesta.en || nota.creado,
    });
  }
  const { texto: _t, adjuntos: _a, respuesta: _r, ...resto } = nota;
  return { ...resto, mensajes };
}

// Quién puede escribir y tocar una conversación: los dos que hablan, y el
// gestor en las que van dirigidas a él.
function puedeTocar(nota, quien) {
  if (!nota) return false;
  if (quien === ADMIN_EMAIL) return nota.tipo !== 'companero' || nota.email === quien;
  return nota.email === quien || nota.deEmail === quien;
}

function añadirMensaje(nota, { de, autor, cuerpo, adjuntos }) {
  const n = normalizar(nota);
  return { ...n, mensajes: [...n.mensajes, {
    de, autor: String(autor || '').slice(0, 80),
    texto: cuerpo, adjuntos, en: new Date().toISOString(),
  }] };
}

// Dar el visto, denegar o archivar. Aceptar o denegar deja además un mensaje
// en el hilo: así el trabajador se entera por el mismo camino que todo lo
// demás —sin leer, campana, aviso en la barra— aunque el gestor no escriba
// nada, y encima queda la fecha en que se resolvió.
function tocarNota(nota, { estado, archivada, gestor }) {
  const n = normalizar(nota);
  if (['pendiente', 'ok', 'no'].includes(estado) && estado !== n.estado) {
    n.estado = estado;
    if (estado !== 'pendiente') {
      n.mensajes = [...n.mensajes, {
        de: 'gestor', autor: String(gestor || '').slice(0, 80), sistema: true,
        texto: estado === 'ok' ? '✅ Petición aceptada' : '❌ Petición denegada',
        adjuntos: [], en: new Date().toISOString(),
      }];
    }
  }
  if (archivada !== undefined) n.archivada = !!archivada;
  return n;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email, X-User-Email, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Con ?email= se devuelven solo las suyas, que es lo que pide su app.
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const quien = String(req.query?.email || '').toLowerCase().trim();
      // Con ?resumen=1 solo se devuelve una huella por conversación: es lo que
      // consultan las apps cada poco para saber si hay algo nuevo sin bajarse
      // los mensajes enteros, que con adjuntos pesan lo suyo.
      const soloResumen = req.query?.resumen !== undefined;
      // Con base de datos el filtro y el orden los hace Postgres, que para eso
      // tiene los índices; si no, se filtra aquí como siempre.
      const huella = notas => notas.map(n => {
        const m = n.mensajes || [];
        return { id: n.id, n: m.length, en: m.length ? m[m.length - 1].en : n.creado,
                 estado: n.estado, archivada: !!n.archivada };
      });
      if (hayBaseDeDatos()) {
        const notas = (await leerNotas(quien)).map(normalizar);
        return res.status(200).json(soloResumen ? huella(notas) : notas);
      }
      const { data } = await getFile();
      // Las mías son las que me llegan y las que he mandado a un compañero
      const notas = Object.values(data)
        .filter(n => !quien || (n.email || '').toLowerCase() === quien
                            || (n.deEmail || '').toLowerCase() === quien)
        .sort((a, b) => (b.creado || '').localeCompare(a.creado || ''))
        .map(normalizar);
      return res.status(200).json(soloResumen ? huella(notas) : notas);
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

      // Con id se contesta dentro de la conversación, que es lo que hace un
      // chat: el mensaje se añade al hilo en vez de abrir uno nuevo. Pueden
      // hacerlo los dos que hablan, no solo quien empezó.
      const hilo = String(b.id || '').trim();
      if (hilo) {
        const previa = hayBaseDeDatos() ? await leerNota(hilo) : (await getFile()).data[hilo];
        if (!previa) return res.status(404).json({ error: 'Esa conversación ya no está' });
        if (!puedeTocar(previa, quien)) {
          return res.status(403).json({ error: 'Esa conversación no es tuya' });
        }
        const soyGestor = quien === ADMIN_EMAIL && previa.tipo !== 'companero';
        const conMensaje = añadirMensaje(previa, {
          de: soyGestor ? 'gestor' : quien,
          autor: soyGestor ? (b.gestor || 'Gestión') : (b.nombre || b.deNombre || ''),
          cuerpo, adjuntos,
        });
        if (hayBaseDeDatos()) {
          await guardarNota(conMensaje);
          return res.status(200).json(conMensaje);
        }
        const guardado = await guardarConReintento(
          data => acotarAdjuntos({ ...data, [hilo]: conMensaje }), `Mensaje en ${hilo}`);
        return guardado ? res.status(200).json(conMensaje)
                        : res.status(500).json({ error: 'No se pudo guardar' });
      }

      // El gestor puede abrir la conversación él: la nota se guarda a nombre
      // del trabajador, que es quien la verá en su app, pero firmada por él.
      const para = String(b.para || '').toLowerCase().trim();
      // Con destinatario hay dos casos: el gestor escribiendo a un trabajador
      // y un trabajador escribiendo a un compañero. Firmar como gestión exige
      // el token; con la cabecera sola cualquiera podría hacerse pasar por él.
      const delGestor = !!para && b.tipo !== 'companero';
      if (delGestor && delToken !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Solo el gestor escribe a un trabajador' });
      }
      const entreCompaneros = !!para && !delGestor;
      if (entreCompaneros && !para.includes('@')) {
        return res.status(400).json({ error: 'Falta el compañero' });
      }
      // La hora la pone el servidor: así no depende del reloj del móvil
      const creado = new Date().toISOString();
      const id = `${creado.replace(/[-:.TZ]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
      const nueva = {
        id, email: para || quien, creado,
        nombre:    String(b.nombre || '').slice(0, 80),
        conductor: String(b.conductor || '').slice(0, 12),
        mensajes: [{
          de: delGestor ? 'gestor' : (entreCompaneros ? quien : 'trabajador'),
          autor: delGestor ? String(b.gestor || 'Gestión').slice(0, 80)
               : String(b.deNombre || b.nombre || '').slice(0, 80),
          texto: cuerpo, adjuntos, en: creado,
        }],
        archivada: false,
        de: delGestor ? 'gestor' : 'trabajador',
        // Un mensaje entre compañeros no es una petición a gestión: no lleva
        // estado que atender y no sale en su lista.
        tipo: entreCompaneros ? 'companero' : 'gestion',
        ...(entreCompaneros ? { deEmail: quien,
              deNombre: String(b.deNombre || '').slice(0, 80),
              deConductor: String(b.deConductor || '').slice(0, 12) } : {}),
        ...(delGestor ? { gestor: String(b.gestor || '').slice(0, 80) } : {}),
        estado: 'pendiente',
      };
      if (hayBaseDeDatos()) {
        // Una fila por nota: no hay que recortar nada para que quepa
        await guardarNota(nueva);
        return res.status(200).json(nueva);
      }
      const nuevo = await guardarConReintento(data => acotarAdjuntos(recortar({ ...data, [id]: nueva })),
        entreCompaneros ? `Mensaje de ${quien} para ${para}`
        : delGestor ? `Nota del gestor para ${para}` : `Nota de ${quien}`);
      return nuevo ? res.status(200).json(nueva) : res.status(500).json({ error: 'No se pudo guardar' });
    }

    // Contestar y dar el visto o denegar es cosa del gestor
    // Archivar, borrar y —solo el gestor— dar el visto o denegar. Cada uno
    // manda en sus conversaciones, así que aquí no vale solo el gestor.
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      const delToken = await emailDelToken(tokenDe(req));
      const quien = delToken || (req.headers['x-admin-email'] || req.headers['x-user-email'] || '')
        .toLowerCase().trim();
      const { id, estado, archivada, gestor } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Falta la nota' });
      if (!quien || !quien.includes('@')) return res.status(400).json({ error: 'Falta el usuario' });
      // Dar el visto o denegar es de quien atiende la petición
      if (estado !== undefined && quien !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Eso solo lo hace gestión' });
      }

      if (hayBaseDeDatos()) {
        const n = await leerNota(id);
        if (!puedeTocar(n, quien)) return res.status(404).json({ error: 'Esa conversación no es tuya' });
        if (req.method === 'DELETE') {
          await borrarNota(id);
          return res.status(200).json({ id, borrada: true });
        }
        const tocada = tocarNota(n, { estado, archivada, gestor });
        await guardarNota(tocada);
        return res.status(200).json(tocada);
      }
      let prohibido = false;
      const nuevo = await guardarConReintento(data => {
        if (!data[id]) return null;
        if (!puedeTocar(data[id], quien)) { prohibido = true; return null; }
        if (req.method === 'DELETE') { const out = { ...data }; delete out[id]; return out; }
        return acotarAdjuntos({ ...data, [id]: tocarNota(data[id], { estado, archivada, gestor }) });
      }, req.method === 'DELETE' ? `Quitar conversación ${id}` : `Cambio en ${id}`);
      if (!nuevo) {
        return res.status(prohibido ? 403 : 404)
          .json({ error: prohibido ? 'Esa conversación no es tuya' : 'No se pudo actualizar' });
      }
      return res.status(200).json(nuevo[id] || { id, borrada: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
