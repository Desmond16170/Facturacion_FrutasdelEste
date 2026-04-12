// api/productos.js
// GET  /api/productos        → lista todos (público)
// POST /api/productos        → crear (admin)
// PUT  /api/productos?id=X   → editar (admin)
// DELETE /api/productos?id=X → eliminar (admin)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key — solo en servidor
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — público, no requiere auth
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('productos')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // Para write operations — verificar token de Supabase Auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

  // POST — crear producto
  if (req.method === 'POST') {
    const { nombre, precio, categoria, unidad, emoji, descripcion, imagen_url, imagen_path } = req.body;
    if (!nombre || !precio) return res.status(400).json({ error: 'Faltan campos' });
    const { data, error } = await supabase.from('productos').insert([
      { nombre, precio, categoria, unidad, emoji, descripcion, imagen_url, imagen_path }
    ]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // PUT — editar producto
  if (req.method === 'PUT') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });
    const { nombre, precio, categoria, unidad, emoji, descripcion, imagen_url, imagen_path } = req.body;
    const { data, error } = await supabase.from('productos').update(
      { nombre, precio, categoria, unidad, emoji, descripcion, imagen_url, imagen_path }
    ).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // DELETE — eliminar producto
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });

    // Obtener imagen_path para borrarla de Storage
    const { data: prod } = await supabase.from('productos').select('imagen_path').eq('id', id).single();
    if (prod?.imagen_path) {
      await supabase.storage.from('productos').remove([prod.imagen_path]);
    }

    const { error } = await supabase.from('productos').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
