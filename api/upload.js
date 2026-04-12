// api/upload.js
// POST /api/upload  → recibe imagen como base64, la sube a Supabase Storage
// Requiere auth token
// Body: { base64, mimeType, carpeta? }
//   carpeta: 'productos' (default) | 'logos'

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verificar auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

  const { base64, mimeType, carpeta } = req.body;
  if (!base64) return res.status(400).json({ error: 'Falta imagen' });

  // Carpeta destino: 'logos' o 'productos' (default)
  const folder = carpeta === 'logos' ? 'logos' : 'productos';
  const bucket = 'productos'; // mismo bucket, distinta subcarpeta
  const buffer = Buffer.from(base64, 'base64');
  const path   = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.webp`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '31536000'
    });

  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: { publicUrl } } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);

  return res.status(200).json({ url: publicUrl, path });
}

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };
