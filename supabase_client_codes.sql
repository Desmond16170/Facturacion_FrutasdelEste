-- Ejecutar en el SQL Editor de Supabase
-- Tabla de códigos de cliente con precios especiales

create table if not exists client_codes (
  code        text primary key,           -- Código que ingresa el cliente, ej: "CLIENTE01"
  label       text,                       -- Etiqueta interna, ej: "Distribuidor zona norte"
  discount    integer default 0,          -- Descuento global en %, ej: 20 = 20% de descuento
  rules       jsonb default '[]'::jsonb,  -- Reglas por producto: [{productId, price}]
  created_at  timestamptz default now()
);

-- Permitir lectura pública (para que el cliente pueda validar su código)
alter table client_codes enable row level security;

create policy "Lectura pública de códigos"
  on client_codes for select
  using (true);

create policy "Solo admin puede modificar códigos"
  on client_codes for all
  using (auth.role() = 'authenticated');

-- Ejemplo de inserción:
-- insert into client_codes (code, label, discount, rules)
-- values (
--   'CLIENTE01',
--   'Distribuidor zona norte',
--   0,           -- sin descuento global
--   '[{"productId":"uuid-del-producto","price":1500}]'::jsonb
-- );

-- Ejemplo con descuento global del 20%:
-- insert into client_codes (code, label, discount, rules)
-- values ('MAYORISTA', 'Cliente mayorista', 20, '[]'::jsonb);
