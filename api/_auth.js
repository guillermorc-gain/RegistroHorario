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

// Devuelve el correo que Google asocia al token, o '' si no vale.
export async function emailDelToken(token) {
  if (!token || token.length > 4096) return '';
  limpiar();
  const guardado = cache.get(token);
  if (guardado) return guardado.email;
  try {
    const r = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
    if (!r.ok) return '';
    const info = await r.json();
    // El aud tiene que ser nuestro cliente: si no, valdría un token que otra
    // aplicación cualquiera hubiera conseguido para el mismo usuario.
    if (info.aud !== GOOGLE_CLIENT_ID) return '';
    if (info.email_verified === 'false' || info.email_verified === false) return '';
    const email = String(info.email || '').toLowerCase().trim();
    if (!email.includes('@')) return '';
    cache.set(token, { email, hasta: Date.now() + TTL });
    return email;
  } catch (_) {
    return '';
  }
}

// Para las acciones del gestor. Responde 401/403 y devuelve '' si no pasa.
export async function exigirAdmin(req, res, adminEmail) {
  const email = await emailDelToken(tokenDe(req));
  if (!email) {
    res.status(401).json({ error: 'Sesión no válida. Vuelve a entrar en la app.' });
    return '';
  }
  if (email !== String(adminEmail).toLowerCase()) {
    res.status(403).json({ error: 'Solo el gestor puede hacer esto' });
    return '';
  }
  return email;
}
