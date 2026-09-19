// Quién hace la petición se comprobaba con una cabecera que rellena el propio
// cliente, así que cualquiera podía decir que era el gestor. Aquí se valida el
// token de Google contra Google: de ahí sale el correo, y no de lo que diga la
// petición.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '563294598347-2sag5tsloqdrd9eh19kfnnc3nrc2gnja.apps.googleusercontent.com';

// Un token vale una hora; guardarlo un minuto evita consultar a Google en cada
// petición sin que una sesión revocada siga colando mucho rato.
const cache = new Map();
const TTL = 60 * 1000;

function limpiar() {
  const ahora = Date.now();
  for (const [k, v] of cache) if (v.hasta <= ahora) cache.delete(k);
}

export function tokenDe(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  return m ? m[1] : '';
}

// Comprueba el token con Google. Devuelve {email} si vale, o {motivo} con el
// porqué. Se distingue el token rechazado de no haber podido preguntar: lo
// primero es culpa de quien llama, lo segundo no, y no debe dejar fuera al
// gestor por un corte entre Vercel y Google.
export async function revisarToken(token) {
  if (!token) return { motivo: 'sin_token' };
  if (token.length > 4096) return { motivo: 'token_raro' };
  limpiar();
  const guardado = cache.get(token);
  if (guardado) return { email: guardado.email };
  let r;
  try {
    r = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  } catch (_) {
    return { motivo: 'google_no_responde' };
  }
  if (r.status >= 500) return { motivo: 'google_no_responde' };
  if (!r.ok) return { motivo: 'token_caducado' };
  let info;
  try { info = await r.json(); } catch (_) { return { motivo: 'google_no_responde' }; }
  // El aud tiene que ser nuestro cliente: si no, valdría un token que otra
  // aplicación cualquiera hubiera conseguido para el mismo usuario.
  if (info.aud !== GOOGLE_CLIENT_ID) return { motivo: 'otra_aplicacion' };
  if (info.email_verified === 'false' || info.email_verified === false) return { motivo: 'correo_sin_verificar' };
  const email = String(info.email || '').toLowerCase().trim();
  if (!email.includes('@')) return { motivo: 'token_sin_correo' };
  cache.set(token, { email, hasta: Date.now() + TTL });
  return { email };
}

// Devuelve el correo que Google asocia al token, o '' si no vale.
export async function emailDelToken(token) {
  return (await revisarToken(token)).email || '';
}

const MENSAJES = {
  sin_token: ['La app no ha enviado la sesión. Actualiza la app de gestión.', 401],
  token_raro: ['Sesión no válida. Vuelve a entrar en la app.', 401],
  token_caducado: ['Tu sesión de Google ha caducado. Cierra y vuelve a entrar en la app.', 401],
  otra_aplicacion: ['Esa sesión no es de esta aplicación.', 401],
  correo_sin_verificar: ['Tu cuenta de Google no tiene el correo verificado.', 401],
  token_sin_correo: ['La sesión no incluye el correo. Vuelve a entrar en la app.', 401],
  google_no_responde: ['No se ha podido comprobar la sesión con Google. Inténtalo en un minuto.', 503],
};

// Para las acciones del gestor. Responde el error y devuelve '' si no pasa.
export async function exigirAdmin(req, res, adminEmail) {
  const { email, motivo } = await revisarToken(tokenDe(req));
  if (!email) {
    const [texto, codigo] = MENSAJES[motivo] || MENSAJES.token_raro;
    res.status(codigo).json({ error: texto, motivo });
    return '';
  }
  if (email !== String(adminEmail).toLowerCase()) {
    res.status(403).json({ error: `Esta cuenta (${email}) no es la del gestor`, motivo: 'no_es_gestor' });
    return '';
  }
  return email;
}
