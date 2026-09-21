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

// ── Quién puede gestionar ───────────────────────────────────────────────────
// El gestor principal se encarga de la aplicación y de que funcione; los
// correos que él autoriza se encargan de gestionar a los trabajadores, y para
// eso tienen que poder hacer lo mismo que él. La lista es la misma que decide
// quién entra en la app de gestión, así que no hay dos sitios que cuadrar.
const REPO_DATOS    = 'guillermorc-gain/RegistroHorario';
const RAMA_DATOS    = 'datos';
const LISTA_GESTION = 'allowed-users-gestion.json';
export const GESTOR_PRINCIPAL = 'g.rioscorrea@gmail.com';

// La lista cambia muy de tanto en tanto y esto se consulta en cada escritura:
// un minuto de memoria evita ir a GitHub a cada petición.
let listaCache = { emails: null, hasta: 0 };

async function listaDeGestion() {
  if (listaCache.emails && Date.now() < listaCache.hasta) return listaCache.emails;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${REPO_DATOS}/contents/${LISTA_GESTION}?ref=${RAMA_DATOS}`,
      { headers: {
          'User-Agent': 'horasemt-app',
          Accept: 'application/vnd.github+json',
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        } }
    );
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const emails = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    listaCache = {
      emails: (Array.isArray(emails) ? emails : []).map(e => String(e).toLowerCase().trim()),
      hasta: Date.now() + 60 * 1000,
    };
  } catch (_) {
    // Si no se puede leer, no se estrena a nadie: se reusa la última buena un
    // rato corto, y si nunca hubo, solo pasa el gestor principal. Un corte con
    // GitHub no puede abrir la puerta, pero tampoco cerrársela a quien ya
    // estaba dentro.
    if (!listaCache.emails) return null;
    listaCache.hasta = Date.now() + 15 * 1000;
  }
  return listaCache.emails;
}

export async function esGestor(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return false;
  if (e === GESTOR_PRINCIPAL) return true;
  const lista = await listaDeGestion();
  return !!lista && lista.includes(e);
}

// Para las acciones de gestión. Responde el error y devuelve '' si no pasa.
export async function exigirGestor(req, res) {
  const { email, motivo } = await revisarToken(tokenDe(req));
  if (!email) {
    const [texto, codigo] = MENSAJES[motivo] || MENSAJES.token_raro;
    res.status(codigo).json({ error: texto, motivo });
    return '';
  }
  if (await esGestor(email)) return email;
  res.status(403).json({ error: `Esta cuenta (${email}) no tiene acceso a gestión`, motivo: 'no_es_gestor' });
  return '';
}

// Para lo que sigue siendo solo del gestor principal: quién tiene acceso a la
// aplicación y qué versión se le ofrece a la gente.
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
