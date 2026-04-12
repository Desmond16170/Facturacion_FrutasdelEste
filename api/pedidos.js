// api/pedidos.js
// POST /api/pedidos   → crear pedido (cliente, público)
// GET  /api/pedidos   → listar pedidos (admin)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — cliente crea pedido (no requiere auth)
  if (req.method === 'POST') {
    const { cliente, direccion, items, total } = req.body;
    if (!cliente || !items?.length) return res.status(400).json({ error: 'Faltan datos' });
    const { data, error } = await supabase.from('pedidos').insert([
      { cliente, direccion, items, total, estado: 'pendiente' }
    ]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // GET — solo admin puede ver pedidos
  if (req.method === 'GET') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token inválido' });

    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
