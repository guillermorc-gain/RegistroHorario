const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_EMAIL  = 'guillermo.rc82@gmail.com';
const REPO         = 'guillermorc-gain/RegistroHorario';
const FILE_PATH    = 'allowed-users.json';
const BRANCH       = 'main';

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
  if (!r.ok) return { emails: [], sha: null };
  const data = await r.json();
  const emails = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { emails: Array.isArray(emails) ? emails : [], sha: data.sha };
}

async function setFile(emails, sha) {
  const content = Buffer.from(JSON.stringify(emails, null, 2) + '\n').toString('base64');
  const body = { message: 'Actualizar usuarios con acceso', content, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  return r.ok;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Email');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const { emails } = await getFile();
      return res.status(200).json(emails);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const adminEmail = (req.headers['x-admin-email'] || '').toLowerCase();
  if (adminEmail !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Solo el administrador puede modificar la lista' });
  }

  const { email } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email inválido' });
  const norm = email.toLowerCase().trim();

  try {
    const { emails, sha } = await getFile();

    if (req.method === 'POST') {
      if (!emails.map(e => e.toLowerCase()).includes(norm)) emails.push(norm);
      const ok = await setFile(emails, sha);
      return res.status(ok ? 200 : 500).json(ok ? { emails } : { error: 'No se pudo guardar' });
    }

    if (req.method === 'DELETE') {
      const filtered = emails.filter(e => e.toLowerCase() !== norm);
      const ok = await setFile(filtered, sha);
      return res.status(ok ? 200 : 500).json(ok ? { emails: filtered } : { error: 'No se pudo guardar' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  return res.status(405).end();
}
