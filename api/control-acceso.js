import Anthropic from '@anthropic-ai/sdk';
import { exigirGestor } from './_auth.js';

// Lee una hoja de control de acceso escrita a mano (foto o PDF) y devuelve las
// filas ya separadas: fecha, hora, matrícula, empresa y nombre. La letra de
// cada uno es la que es, así que lo que no se lee con seguridad vuelve marcado
// como dudoso para que se revise antes de pasarlo al Excel, en vez de
// inventarse un dato que luego nadie mira.
//
// Cuesta dinero en cada llamada, así que solo la pueden usar los de gestión.

const MODELO = 'claude-opus-5';
// Vercel no deja pasar cuerpos de más de ~4,5 MB; la web reduce las fotos
// antes de mandarlas, y esto es la red por si llega algo que no se redujo.
const MAX_BASE64 = 4 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

const ESQUEMA = {
  type: 'object',
  properties: {
    mes: { type: 'integer', description: 'Mes de la hoja, 1-12, o 0 si no se sabe' },
    anio: { type: 'integer', description: 'Año con cuatro cifras, o 0 si no se sabe' },
    registros: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'AAAA-MM-DD, o vacío si no aparece' },
          hora: { type: 'string', description: 'HH:MM en 24 h, o vacío' },
          matricula: { type: 'string', description: 'Sin espacios ni guiones, en mayúsculas' },
          empresa: { type: 'string' },
          nombre: { type: 'string' },
          dudoso: { type: 'boolean', description: 'true si algún campo de la fila no se lee con seguridad' },
          nota: { type: 'string', description: 'Qué campo es dudoso y por qué; vacío si no hay nada' },
        },
        required: ['fecha', 'hora', 'matricula', 'empresa', 'nombre', 'dudoso', 'nota'],
        additionalProperties: false,
      },
    },
    observaciones: { type: 'string', description: 'Algo de la hoja entera que convenga saber; vacío si nada' },
  },
  required: ['mes', 'anio', 'registros', 'observaciones'],
  additionalProperties: false,
};

const INSTRUCCIONES = `Tienes delante una hoja de control de acceso rellenada a mano. Cada fila es una entrada: día, hora, matrícula del vehículo, empresa y nombre de la persona. Pásala a datos, fila por fila y en el orden de la hoja.

- Transcribe lo que pone. No completes con lo que "debería" poner ni corrijas nombres o empresas a algo que te suene; si dudas entre dos lecturas, pon la más probable, marca la fila como dudosa y explica en "nota" qué campo y qué alternativas ves.
- Fecha: busca en la hoja el mes y el año (cabecera, sello, fechas escritas). Si la fila solo lleva el día, completa con ese mes y año. Si hay filas sin día, usa el de la fila anterior (es normal que se escriba el día una vez y debajo se deje en blanco o con comillas). Devuelve mes y año de la hoja aparte; 0 si de verdad no aparecen.
- Hora en 24 h (HH:MM). "8.30" es 08:30; si no hay minutos, :00.
- Matrícula en mayúsculas, sin espacios ni guiones (por ejemplo 1234ABC). Ojo con 0/O, 1/I, 5/S, 8/B: en matrículas españolas actuales van cuatro cifras y tres consonantes.
- Salta las filas vacías, las cabeceras y las rayas. Si una fila repite la de arriba con comillas o "ídem", copia el valor de arriba.
- Si la imagen no es una hoja de este tipo o no se lee nada, devuelve registros vacío y dilo en "observaciones".`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!(await exigirGestor(req, res))) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel' });
  }

  const { datos, tipo, pista } = req.body || {};
  if (typeof datos !== 'string' || !datos) return res.status(400).json({ error: 'No ha llegado el archivo' });
  if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo de archivo no admitido: ' + tipo });
  if (datos.length > MAX_BASE64) return res.status(413).json({ error: 'El archivo es demasiado grande (máx. ~3 MB)' });

  const adjunto = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: tipo, data: datos } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: datos } };

  // El mes que se tiene abierto en la web ayuda cuando la hoja no lo pone,
  // pero lo que se lea en la hoja manda.
  const texto = pista && /^\d{4}-\d{2}$/.test(pista)
    ? `Mes abierto en la aplicación: ${pista}. Úsalo solo si la hoja no indica mes y año.`
    : 'Transcribe la hoja.';

  const client = new Anthropic();
  let msg;
  try {
    // En streaming para que una hoja larga no se corte por tiempo de espera.
    const stream = client.beta.messages.stream({
      model: MODELO,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: ESQUEMA } },
      system: INSTRUCCIONES,
      messages: [{ role: 'user', content: [adjunto, { type: 'text', text: texto }] }],
    });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Demasiadas peticiones seguidas. Espera un minuto y vuelve a probar.' });
    }
    if (e instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: 'No se ha podido leer el archivo: ' + e.message });
    }
    if (e instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `El servicio de lectura ha fallado (${e.status ?? 'sin respuesta'}). Vuelve a probar.` });
    }
    return res.status(502).json({ error: 'No se ha podido contactar con el servicio de lectura.' });
  }

  if (msg.stop_reason === 'refusal') {
    return res.status(422).json({ error: 'El servicio no ha querido procesar esta imagen.' });
  }
  if (msg.stop_reason === 'max_tokens') {
    return res.status(422).json({ error: 'La hoja es demasiado larga para leerla de una vez. Prueba a hacer la foto en dos mitades.' });
  }
  const bloque = msg.content.find(b => b.type === 'text');
  let resultado;
  try {
    resultado = JSON.parse(bloque?.text || '');
  } catch (_) {
    return res.status(502).json({ error: 'La lectura ha vuelto en un formato inesperado. Vuelve a probar.' });
  }
  return res.status(200).json(resultado);
}
