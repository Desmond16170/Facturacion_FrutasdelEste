# ✅ Guía de activación — Supabase + Vercel

## Estructura final
```
tienda-supabase/
├── index.html              → tudominio.com/
├── admin/
│   └── index.html          → tudominio.com/admin
├── api/
│   ├── productos.js        → GET público / write protegido
│   ├── pedidos.js          → POST público / GET protegido
│   └── upload.js           → subida de imágenes protegida
├── vercel.json
└── package.json
```

---

## PASO 1 — Crear proyecto en Supabase (gratis, sin tarjeta)

1. Ve a https://supabase.com → **Start your project**
2. Crear cuenta con GitHub → **New project**
   - Name: `frutas-y-jugos-del-este`
   - Database password: anótala (no la necesitás para esto)
   - Region: `South America (São Paulo)` — la más cercana a CR
3. Esperar ~2 minutos a que se cree

---

## PASO 2 — Crear las tablas (SQL)

En Supabase → menú izquierdo → **SQL Editor** → **New query**

Pegá esto y ejecutá con el botón **Run**:

```sql
-- Tabla de productos
create table productos (
  id           uuid default gen_random_uuid() primary key,
  nombre       text not null,
  precio       numeric not null,
  categoria    text not null check (categoria in ('pulpa','galon')),
  unidad       text,
  emoji        text,
  descripcion  text,
  imagen_url   text default '',
  imagen_path  text default '',
  created_at   timestamptz default now()
);

-- Tabla de pedidos
create table pedidos (
  id          uuid default gen_random_uuid() primary key,
  cliente     text not null,
  direccion   text,
  items       jsonb not null,
  total       numeric not null,
  estado      text default 'pendiente',
  created_at  timestamptz default now()
);

-- Permitir lectura pública de productos
alter table productos enable row level security;
create policy "Productos públicos" on productos for select using (true);
create policy "Solo admin escribe productos" on productos for all using (auth.role() = 'authenticated');

-- Pedidos: cualquiera crea, solo admin lee
alter table pedidos enable row level security;
create policy "Clientes crean pedidos" on pedidos for insert with check (true);
create policy "Solo admin lee pedidos" on pedidos for select using (auth.role() = 'authenticated');
```

---

## PASO 3 — Crear bucket de Storage

En Supabase → **Storage** → **New bucket**
- Name: `productos`
- Public bucket: ✅ activado
- Click **Create bucket**

---

## PASO 4 — Crear usuario administrador

En Supabase → **Authentication** → **Users** → **Invite user**
- Email: el correo de tu papá
- Le llega un email para que ponga su contraseña

---

## PASO 5 — Obtener las credenciales

En Supabase → **Project Settings** → **API**

Necesitás dos cosas:

| Variable              | Dónde está                          |
|-----------------------|-------------------------------------|
| `SUPABASE_URL`        | "Project URL"                       |
| `SUPABASE_ANON_KEY`   | "Project API keys" → `anon public`  |
| `SUPABASE_SERVICE_KEY`| "Project API keys" → `service_role` |

---

## PASO 6 — Editar el admin/index.html

Abrí `admin/index.html` y buscá estas dos líneas cerca del final:

```javascript
const SUPABASE_URL      = 'TU_SUPABASE_URL';       // ← pegá el Project URL
const SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY';  // ← pegá el anon key
```

La `service_role` key **NO va en el HTML**, solo va en Vercel como variable de entorno (paso 7).

---

## PASO 7 — Publicar en Vercel (gratis, sin tarjeta)

### Opción A — Sin código (más fácil):
1. Subí la carpeta a GitHub (nuevo repositorio)
2. Ve a https://vercel.com → **Add New Project** → importá el repo
3. En **Environment Variables** agregá:
   - `SUPABASE_URL` = tu Project URL
   - `SUPABASE_SERVICE_KEY` = tu service_role key
4. Click **Deploy** → listo 🎉

### Opción B — Con CLI:
```bash
npm install -g vercel
cd tienda-supabase
vercel

# Cuando pregunte environment variables, agregá:
# SUPABASE_URL y SUPABASE_SERVICE_KEY
```

---

## PASO 8 — Dominio propio (opcional)

En Vercel → tu proyecto → **Settings** → **Domains** → agregar `frutasyjugosdeleste.com`
Vercel te da las instrucciones DNS exactas para tu registrador.

---

## Resumen de costos

| Servicio  | Plan gratuito incluye                              |
|-----------|----------------------------------------------------|
| Supabase  | 500MB DB, 1GB Storage, 50k usuarios auth, 2GB transferencia/mes |
| Vercel    | 100GB bandwidth, funciones serverless ilimitadas   |
| **Total** | **₡0 al mes** para el volumen de una tienda pequeña |
