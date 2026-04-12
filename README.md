# Frutas y Jugos del Este 🧃

Catálogo online con panel de administración. Desplegado en Vercel + Supabase.

## Variables de entorno (Vercel)

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=tu_service_role_key
```

## Tablas requeridas en Supabase

### productos
```sql
create table productos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  nombre      text not null,
  precio      numeric not null,
  categoria   text,
  unidad      text,
  emoji       text,
  descripcion text,
  imagen_url  text,
  imagen_path text,
  en_oferta   boolean default false,
  precio_oferta numeric,
  es_promocion boolean default false,
  agotado     boolean default false
);
```

### pedidos
```sql
create table pedidos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  cliente    text not null,
  direccion  text,
  items      jsonb,
  total      numeric,
  estado     text default 'pendiente'
);
```

### logos
```sql
create table logos (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  url        text not null,
  path       text,
  nombre     text
);
```

## Storage en Supabase

Crear un bucket llamado **`productos`** (público).  
Las imágenes de productos se guardan en la subcarpeta `productos/`  
Los logos se guardan en la subcarpeta `logos/`

## Estructura del proyecto

```
/
├── index.html          → Catálogo público
├── admin/
│   └── index.html      → Panel de administración (requiere login)
├── api/
│   ├── productos.js    → CRUD de productos
│   ├── pedidos.js      → CRUD de pedidos
│   ├── upload.js       → Subida de imágenes a Storage
│   └── logos.js        → CRUD de logos
├── vercel.json
└── package.json
```

## Deploy

1. Fork o subí el repo a GitHub
2. Importalo en [vercel.com](https://vercel.com)
3. Agregá las variables de entorno
4. Creá el usuario admin en Supabase → Authentication → Users → Invite user
