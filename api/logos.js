// api/logos.js
// GET    /api/logos        → lista todos los logos (admin)
// POST   /api/logos        → guarda un logo nuevo (admin)
// DELETE /api/logos/:id    → elimina logo de DB y Storage (admin)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verificar auth en todos los métodos
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

  // GET — listar logos
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('logos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // POST — guardar logo (después de hacer upload)
  if (req.method === 'POST') {
    const { url, path, nombre } = req.body;
    if (!url) return res.status(400).json({ error: 'Falta url' });
    const { data, error } = await supabase
      .from('logos')
      .insert([{ url, path, nombre: nombre || '' }])
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // DELETE — eliminar logo
  if (req.method === 'DELETE') {
    // El id viene en la URL: /api/logos/123
    const id = req.url.split('/').pop();
    if (!id) return res.status(400).json({ error: 'Falta id' });

    // Obtener path para borrar del Storage
    const { data: logo } = await supabase
      .from('logos')
      .select('path')
      .eq('id', id)
      .single();

    // Borrar archivo del Storage si existe
    if (logo?.path) {
      await supabase.storage.from('productos').remove([logo.path]);
    }

    // Borrar registro de la tabla
    const { error } = await supabase.from('logos').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
