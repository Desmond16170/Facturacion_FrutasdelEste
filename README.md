# 🍎 Jugos y Frutas Del Este — Sitio web y gestión de catálogo

> Plataforma web para **Jugos y Frutas Del Este**, negocio costarricense de pulpas congeladas y galones de fruta. El proyecto integra el sitio público de la marca con catálogo de productos, cotizaciones por WhatsApp y un panel administrativo conectado a Supabase.

[![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)](#-estado-del-proyecto)
[![Hecho con](https://img.shields.io/badge/hecho%20con-HTML%20%2B%20CSS%20%2B%20JS%20%2B%20Supabase-3ECF8E)](#-tecnologías)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](#-despliegue)

---

## ✨ Funcionalidades

### 🌐 Sitio público

- 🏠 **Página principal de la marca** con información de productos y servicio
- 🍹 **Presentación de pulpas congeladas y galones naturales**
- 📱 **Diseño responsive** para computadora, tablet y teléfono
- 🖼️ **Carrusel visual de productos**
- 📍 Información sobre zonas de entrega
- 💳 Información sobre métodos de pago
- 💬 Acceso directo a **WhatsApp**
- 🛒 Enlace al módulo de tienda para consultar y comprar productos
- 📄 Páginas independientes de **Nosotros**, **Contacto** y detalle de producto

### 🛒 Catálogo y cotización

La lógica del proyecto permite trabajar con productos almacenados en Supabase y mostrarlos dinámicamente según su información actual.

Entre las funciones disponibles se encuentran:

- 🔎 Búsqueda y filtrado de productos
- 🗂️ Filtrado por categoría
- ✅ Estado de disponibilidad
- ⭐ Productos destacados
- 💰 Precios en colones costarricenses
- 🛒 Carrito almacenado en el navegador mediante `localStorage`
- ➕ Cambio de cantidades y eliminación de productos del carrito
- 💬 Generación de una **cotización por WhatsApp**
- 📦 Vista individual de productos
- 🔗 Consulta de productos directamente por WhatsApp

---

## 🏷️ Códigos de cliente y precios especiales

El proyecto incluye un sistema de **códigos de cliente** para manejar precios diferenciados.

Un código puede aplicar:

- Un **descuento porcentual global**
- Un **precio fijo para un producto específico**
- Reglas especiales asociadas a productos o categorías

Cuando el cliente introduce un código válido, la aplicación consulta Supabase y aplica automáticamente las reglas de precio correspondientes.

Los códigos activos se conservan localmente en el navegador para mantener la experiencia del usuario.

---

## ⚙️ Panel de administración

El archivo `admin.html` contiene un panel administrativo protegido mediante **Supabase Authentication**.

Desde el panel se pueden gestionar diferentes partes del catálogo:

### 📊 Dashboard

- Total de productos
- Productos disponibles
- Productos no disponibles
- Productos destacados
- Categorías utilizadas
- Productos agregados o modificados recientemente

### 📦 Productos

- Crear productos
- Editar información
- Eliminar productos
- Cambiar disponibilidad
- Marcar o quitar productos destacados
- Definir nombre, descripción, categoría, presentación, precio y referencia
- Subir imágenes de productos a **Supabase Storage**

### 🗂️ Categorías

- Crear categorías
- Visualizar cuántos productos pertenecen a cada categoría
- Eliminar categorías cuando no tienen productos asociados

### 🏷️ Códigos de cliente

- Crear códigos especiales
- Editar códigos existentes
- Definir descuentos globales
- Crear reglas de precio por producto o categoría
- Eliminar códigos

### 📊 Excel

El panel permite trabajar con inventario mediante archivos de Excel:

- **Exportar** productos y categorías a `.xlsx`
- **Importar** productos desde `.xlsx`, `.xls` o `.csv`
- Descargar una plantilla de ejemplo
- Crear categorías nuevas automáticamente durante una importación
- Procesar productos en lotes para evitar errores durante importaciones grandes

La integración utiliza **SheetJS (XLSX)** desde CDN.

---

## 🔐 Autenticación

El acceso administrativo utiliza **Supabase Auth** con correo electrónico y contraseña.

El flujo incluye:

1. Inicio de sesión desde `login.html`
2. Verificación de una sesión activa
3. Redirección al panel administrativo
4. Persistencia y renovación automática de la sesión
5. Cierre de sesión desde el panel

Las funciones públicas del sitio no requieren una cuenta administrativa.

---

## ☁️ Supabase

Supabase funciona como backend del proyecto.

Actualmente se utiliza para:

- **Base de datos** de productos y categorías
- **Códigos de cliente**
- **Autenticación** del panel administrativo
- **Storage** para imágenes de productos
- Consultas y actualización dinámica del catálogo

El archivo `supabase_client_codes.sql` incluye la definición de la tabla `client_codes` y sus políticas de Row Level Security para el sistema de códigos especiales.

> La aplicación utiliza la clave pública/anon de Supabase desde el frontend. Las operaciones sensibles deben protegerse mediante las políticas de acceso configuradas en Supabase.

---

## 🛠️ Tecnologías

- **Frontend** — HTML5, CSS3 y JavaScript vanilla
- **Backend as a Service** — Supabase
- **Base de datos** — PostgreSQL mediante Supabase
- **Autenticación** — Supabase Authentication
- **Archivos** — Supabase Storage
- **Excel** — SheetJS / XLSX
- **Persistencia local** — LocalStorage
- **Mensajería** — integración con WhatsApp mediante enlaces `wa.me`
- **Deploy** — Vercel

> Este proyecto también forma parte de mi proceso de aprendizaje práctico con tecnologías web, SQL/PostgreSQL y Supabase.

---

## 📁 Estructura del proyecto

```text
Facturacion_FrutasdelEste/
├── index.html                  # Página principal
├── nosotros.html               # Información sobre la empresa
├── contacto.html               # Contacto y ubicación
├── producto.html               # Vista individual de producto
├── login.html                  # Inicio de sesión administrativo
├── admin.html                  # Panel de administración
│
├── app.js                      # Lógica principal del sitio y administración
├── styles.css                  # Estilos globales
├── supabase.js                 # Cliente y configuración de Supabase
├── supabase_client_codes.sql   # Tabla y políticas para códigos de cliente
├── vercel.json                 # Configuración de despliegue
│
├── assets/
│   ├── logo.png                # Logo principal
│   └── hero/                   # Recursos visuales del sitio
│
└── README.md
```

---

## 🚀 Ejecutar localmente

El proyecto no necesita un proceso de compilación ni dependencias instaladas mediante npm.

Podés clonar el repositorio y servir los archivos con cualquier servidor HTTP local.

```bash
git clone https://github.com/Desmond16170/Facturacion_FrutasdelEste.git
cd Facturacion_FrutasdelEste

python -m http.server 8080
```

Después abrí:

```text
http://localhost:8080
```

> Para utilizar las funciones conectadas a Supabase, el proyecto debe tener acceso a un proyecto de Supabase correctamente configurado.

---

## 🔧 Configuración

### Supabase

La conexión se inicializa desde:

```text
supabase.js
```

La aplicación espera las tablas, permisos y buckets necesarios para las funciones utilizadas por el sitio y el panel administrativo.

Para el sistema de códigos de cliente se incluye:

```text
supabase_client_codes.sql
```

Este script crea la tabla `client_codes`, habilita Row Level Security y define las políticas utilizadas por esa función.

### Imágenes

Las imágenes cargadas desde el panel administrativo se almacenan mediante **Supabase Storage**.

El código actual utiliza el bucket:

```text
product-images
```

### WhatsApp

Las consultas y cotizaciones generan enlaces de WhatsApp con la información del producto o de los artículos agregados al carrito.

---

## 🌐 Despliegue

El repositorio incluye `vercel.json` y está preparado para desplegarse como un sitio estático en **Vercel**.

La configuración actual utiliza URLs limpias y elimina la barra final de las rutas.

```json
{
  "cleanUrls": true,
  "trailingSlash": false
}
```

---

## 🎯 Objetivo del proyecto

El objetivo es crear una herramienta web útil para una operación comercial real, centralizando la presentación de productos y parte de su administración en una sola plataforma.

Además de servir como sitio para **Jugos y Frutas Del Este**, el proyecto me permite desarrollar experiencia práctica en:

- Desarrollo web responsive
- JavaScript
- Integración frontend/backend
- Gestión de datos con Supabase
- Autenticación
- Almacenamiento de imágenes
- Manejo de inventario y catálogo
- Importación y exportación de datos
- Diseño de herramientas administrativas

---

## 🚧 Estado del proyecto

**En desarrollo y mejora continua.**

La plataforma continúa evolucionando conforme aparecen nuevas necesidades del negocio y se incorporan mejoras en el catálogo, administración y experiencia de usuario.

---

## 👨‍💻 Autor

**Luis Fernando Herrera Vargas**

Estudiante de Ingeniería Eléctrica con énfasis en Computadores y Redes.

- GitHub: [@Desmond16170](https://github.com/Desmond16170)

---

<p align="center">Desarrollado como una solución práctica para Jugos y Frutas Del Este 🍎</p>
