// Dónde viven los datos.
//
// Hasta ahora, en un JSON dentro del repo: cada escritura leía el fichero
// entero, lo modificaba y lo volvía a subir. Con poca gente va bien, pero a
// medida que crece trae dos problemas que no se arreglan con parches:
//
//   · colisiones — todos escriben el mismo fichero, así que a la hora del
//     relevo se pisan unos a otros y, pasados los reintentos, se pierde algo;
//   · peso — publicar un resumen mueve el fichero completo, que con cincuenta
//     trabajadores y un año de jornadas son varios MB por cada guardado.
//
// Con Postgres cada trabajador y cada nota son una fila: escribir a uno no
// toca a los demás y el tamaño deja de importar. El documento que se guarda
// es el mismo de antes, así que toda la lógica de mezcla sigue igual.
//
// Si no están puestas las variables de entorno, todo sigue yendo al repo
// exactamente como hasta ahora. Quitarlas es la vuelta atrás.

const URL_BASE = process.env.SUPABASE_URL || '';
const CLAVE    = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const hayBaseDeDatos = () => !!(URL_BASE && CLAVE);

const cabeceras = (extra = {}) => ({
  apikey: CLAVE,
  Authorization: `Bearer ${CLAVE}`,
  'Content-Type': 'application/json',
  ...extra,
});

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    ...opciones,
    headers: cabeceras(opciones.headers),
    cache: 'no-store',
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error(`Base de datos ${r.status}: ${detalle.slice(0, 200)}`);
  }
  // Un DELETE o un upsert sin "return=representation" no traen cuerpo
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

// ── Trabajadores ────────────────────────────────────────────────────────────

// El mismo objeto { email: documento } que devolvía el fichero, pero sin los
// avatares: son la mitad del peso y cambian una vez al año, así que gestión
// los pide aparte y se los queda cacheados.
export async function leerUsuarios() {
  const filas = await pedir('emt_usuarios?select=email,datos');
  const out = {};
  (filas || []).forEach(f => { out[f.email] = f.datos; });
  return out;
}

export async function leerAvatares() {
  const filas = await pedir('emt_avatares?select=email,datos');
  const out = {};
  (filas || []).forEach(f => { out[f.email] = f.datos; });
  return out;
}

// Aquí sí se devuelve con su avatar: es lo que lee el propio trabajador al
// publicar, y la mezcla de siempre cuenta con encontrarlo donde estaba.
export async function leerUsuario(email) {
  const filtro = `email=eq.${encodeURIComponent(email)}`;
  const [filas, avatares] = await Promise.all([
    pedir(`emt_usuarios?select=datos&${filtro}`),
    pedir(`emt_avatares?select=datos&${filtro}`),
  ]);
  const datos = filas?.[0]?.datos;
  if (!datos) return null;
  return { ...datos, avatar: avatares?.[0]?.datos ?? null };
}

// Leer y escribir un solo trabajador: aquí ya no hay nada que colisione, cada
// uno va a su fila. El avatar se guarda aparte para que no lastre la lista.
export async function guardarUsuario(email, datos) {
  const { avatar, ...resto } = datos || {};
  await pedir('emt_usuarios', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ email, datos: resto, actualizado: new Date().toISOString() }),
  });
  if (avatar) {
    await pedir('emt_avatares', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ email, datos: avatar, actualizado: new Date().toISOString() }),
    });
  } else {
    // Quitarse la foto también tiene que llegar
    await pedir(`emt_avatares?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
  }
  return datos;
}

export async function borrarUsuario(email) {
  const filtro = `email=eq.${encodeURIComponent(email)}`;
  await pedir(`emt_usuarios?${filtro}`, { method: 'DELETE' });
  await pedir(`emt_avatares?${filtro}`, { method: 'DELETE' });
}

// ── Notas ───────────────────────────────────────────────────────────────────

export async function leerNotas(email) {
  const filtro = email
    ? `&or=(email.eq.${encodeURIComponent(email)},de_email.eq.${encodeURIComponent(email)})`
    : '';
  const filas = await pedir(`emt_notas?select=datos&order=creado.desc${filtro}`);
  return (filas || []).map(f => f.datos);
}

export async function guardarNota(nota) {
  await pedir('emt_notas', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: nota.id, email: nota.email, de_email: nota.deEmail || null,
      creado: nota.creado, datos: nota,
    }),
  });
  return nota;
}

export async function leerNota(id) {
  const filas = await pedir(`emt_notas?select=datos&id=eq.${encodeURIComponent(id)}`);
  return filas?.[0]?.datos || null;
}

export async function borrarNota(id) {
  await pedir(`emt_notas?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
}
