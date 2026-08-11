(function () {
  // ─── CONSTANTES ─────────────────────────────────────────────────────────────
  const CART_KEY       = "jf_cart";
  const WA_NUMBER      = "50662253122";
  // Imágenes: se suben a Cloudinary vía /api/upload-image (ver api/upload-image.js)

  const defaultCategories = [
    // Las categorías ya no se hardcodean aquí.
    // Se gestionan 100% desde el admin → pestaña Categorías → Supabase.
  ];

  // ─── IMÁGENES STOCK POR CATEGORÍA ────────────────────────────────────────────
  // Mapa: nombre de categoría (en minúsculas sin tildes) → ruta del SVG stock
const CATEGORY_STOCK_IMAGES = {};

  /** Normaliza un texto: minúsculas, sin tildes, espacios → guion bajo */
  function normalizeStr(str) {
    return (str || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // quita tildes
      .replace(/\s+/g, "_")   // espacios → _ para coincidir con las keys del mapa
      .replace(/_+/g, "_")    // colapsa guiones dobles
      .trim();
  }

  // Caché en memoria para evitar múltiples consultas a la DB por sesión
  const _categoryImageCache = {};  // { "Motor": "https://...", ... }
  let   _categoryImageLoaded = false;

  /** Precarga todas las imágenes de categoría desde Supabase (una sola vez) */
  async function loadCategoryImages() {
    if (_categoryImageLoaded) return;
    _categoryImageLoaded = true;
    try {
      const { data } = await window._sb.from("category_images").select("category,image_url");
      (data || []).forEach(r => {
        if (r.image_url && r.image_url.trim()) {
          _categoryImageCache[normalizeStr(r.category)] = r.image_url.trim();
        }
      });
    } catch (_) { /* si falla la tabla no existe aún, usamos SVGs locales */ }
  }

  /**
   * Devuelve la URL de imagen correcta para un producto:
   * 1. Imagen real subida al producto (Supabase Storage product-images)
   * 2. Imagen de categoría en Supabase Storage (category-images / tabla category_images)
   * 3. SVG stock local en assets/categorias/
   * 4. SVG genérico de producto
   */
  function getProductImage(product) {
    if (product.image && product.image.trim() !== "") return product.image;
    const key = normalizeStr(product.category);
    if (_categoryImageCache[key]) return _categoryImageCache[key];
    return CATEGORY_STOCK_IMAGES[key] || "assets/categorias/default.svg";
  }

  /**
   * Indica si la imagen es stock (no subida por el admin para este producto)
   * Útil para agregar la clase visual "is-stock-image"
   */
  function isStockImage(product) {
    return !product.image || product.image.trim() === "";
  }

  // ─── ESTADO ─────────────────────────────────────────────────────────────────
  const state = {
    page:              document.body.dataset.page,
    products:          [],
    categories:        [...defaultCategories],
    cart:              loadCart(),
    imageDraft:        "",    // blob URL temporal para preview local
    imageDraftFile:    null,  // File object real para subir a Storage
    editingProductId:  "",
    appliedUrlParams:  false,
    session:           null,
    viewingProductId:  "",
    searchMode:        false, // false = destacados, true = resultados de búsqueda
    searchTimer:       null,  // debounce timer
  };

  // ─── ARRANQUE ────────────────────────────────────────────────────────────────
  init();

  // Exponer al window para que módulos externos (carousel, códigos) puedan usarlos
  window._renderProducts = () => { if (state.page === "catalog" || state.page === "home") renderProducts(); };
  window._state = state;
  window.toast = (message, type) => toast(message, type);

  async function init() {
    if (!window._sb) { console.error("supabase.js no cargado"); return; }

    // Precarga imágenes de categoría (Supabase o SVG local como fallback)
    await loadCategoryImages();

    if (state.page === "admin") {
      await guardAdmin();
      bindAdminEvents();
      await loadFromSupabase();
      renderAdmin();
    } else {
      await loadFromSupabase();
      bindStoreEvents();
      renderStore();
    }
  }

  // ─── GUARD ADMIN (redirige a login si no hay sesión) ─────────────────────────
  async function guardAdmin() {
    const { data: { session } } = await window._sb.auth.getSession();
    if (!session) { window.location.href = "login.html"; return; }
    state.session = session;
    const logoutBtn = byId("logoutBtn");
    if (logoutBtn) {
      logoutBtn.hidden = false;
      logoutBtn.addEventListener("click", async () => {
        await window._sb.auth.signOut();
        window.location.href = "login.html";
      });
    }
  }

  // ─── CARGA DESDE SUPABASE ────────────────────────────────────────────────────
  // En el catálogo público: carga solo categorías + destacados al inicio.
  // Los productos se buscan en Supabase al vuelo según los filtros del usuario.
  // En admin: carga todo (necesario para el panel de gestión).
  async function loadFromSupabase() {
    if (state.page === "admin") {
      // Admin necesita todos los productos para gestión.
      // Supabase puede devolver máximo 1000 filas por petición, por eso se pagina con range().
      const [products, { data: categories }] = await Promise.all([
        fetchAllProductsForAdmin(),
        window._sb.from("categories").select("name").order("name"),
      ]);
      state.products   = normalizeProducts(products || []);
      const dbCats     = (categories || []).map(r => r.name);
      // Solo usamos las categorías de la BD (más las default). No mezclamos con p.category
      // para que al borrar una categoría vacía no se recree sola desde los productos.
      state.categories = unique([...defaultCategories, ...dbCats]);
    } else if (state.page === "product") {
      // producto.html carga por ID directo para que no dependa de los destacados iniciales.
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id") || params.get("producto");
      const [{ data: categories }, product] = await Promise.all([
        window._sb.from("categories").select("name").order("name"),
        fetchProductById(id),
      ]);
      const similar = product ? await fetchSimilarProducts(product) : [];
      const dbCats = (categories || []).map(r => r.name);
      state.categories = unique([...defaultCategories, ...dbCats, product?.category].filter(Boolean));
      state.products = normalizeProducts(uniqueProductsById(product ? [product, ...similar] : []));
      state.searchMode = false;
    } else {
      // Tienda pública: solo categorías y destacados
      const [{ data: categories }, { data: featured }] = await Promise.all([
        window._sb.from("categories").select("name").order("name"),
        window._sb.from("products").select("*").eq("featured", true).order("name").limit(24),
      ]);
      const dbCats     = (categories || []).map(r => r.name);
      state.categories = unique([...defaultCategories, ...dbCats]);
      state.products   = normalizeProducts(featured || []);
      state.searchMode = false; // false = mostrando destacados, true = mostrando resultados de búsqueda
    }
  }

  async function fetchAllProductsForAdmin() {
    const pageSize = 1000;
    let from = 0;
    let all = [];

    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await window._sb
        .from("products")
        .select("*")
        .order("featured", { ascending: false })
        .order("name")
        .range(from, to);

      if (error) {
        console.error("Error cargando productos paginados:", error);
        break;
      }

      const rows = data || [];
      all = all.concat(rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return all;
  }

  async function fetchProductById(id) {
    if (!id) return null;
    const { data, error } = await window._sb
      .from("products")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Error cargando producto por ID:", error);
      return null;
    }
    return data || null;
  }

  async function fetchSimilarProducts(product) {
    if (!product) return [];

    let query = window._sb
      .from("products")
      .select("*")
      .neq("id", product.id)
      .order("featured", { ascending: false })
      .order("name")
      .limit(24);

    if (product.category) query = query.eq("category", product.category);
    else if (product.brand) query = query.eq("brand", product.brand);
    else query = query.eq("featured", true);

    const { data, error } = await query;
    if (error) {
      console.error("Error cargando productos similares:", error);
      return [];
    }
    return data || [];
  }

  function uniqueProductsById(products) {
    const seen = new Set();
    return (products || []).filter(product => {
      if (!product || seen.has(String(product.id))) return false;
      seen.add(String(product.id));
      return true;
    });
  }
  // Busca productos en Supabase según los filtros activos
  async function searchInSupabase() {
    const search     = byId("searchInput")?.value.trim().toLowerCase() || "";
    const category   = byId("categoryFilter")?.value || "all";
    const brand      = byId("brandFilter")?.value || "all";
    const availability = byId("availabilityFilter")?.value || "all";
    const sort       = byId("sortFilter")?.value || "featured";

    // Sin filtros activos → volver a mostrar destacados
    const hasFilters = search || category !== "all" || brand !== "all" || availability !== "all";
    if (!hasFilters) {
      if (state.searchMode) {
        // Recargar destacados
        const { data: featured } = await window._sb
          .from("products").select("*").eq("featured", true).order("name").limit(24);
        state.products  = normalizeProducts(featured || []);
        state.searchMode = false;
      }
      return;
    }

    // Construir query
    let query = window._sb.from("products").select("*");

    if (category !== "all") {
      query = query.eq("category", category);
    }
    if (brand !== "all") {
      query = query.eq("brand", brand);
    }
    if (availability === "available") {
      query = query.eq("available", true);
    } else if (availability === "unavailable") {
      query = query.eq("available", false);
    }
    if (search) {
      // Sanitizar: escapar % y _ para evitar abuso de wildcards en ilike
      const safeSearch = search.replace(/%/g, "\\%").replace(/_/g, "\\_").slice(0, 100);
      query = query.or(
        `name.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%,code.ilike.%${safeSearch}%`
      );
    }

    // Orden
    if (sort === "name")       query = query.order("name", { ascending: true });
    else if (sort === "price-asc")  query = query.order("price", { ascending: true });
    else if (sort === "price-desc") query = query.order("price", { ascending: false });
    else query = query.order("featured", { ascending: false }).order("name");

    query = query.limit(200);

    const { data, error } = await query;
    if (error) { console.error(error); return; }
    state.products  = normalizeProducts(data || []);
    state.searchMode = true;
  }

  // ─── SUPABASE: productos ──────────────────────────────────────────────────────
  async function upsertProduct(product) {
    const row = {
      id:              product.id,
      name:            product.name,
      code:            product.code,
      description:     product.description,
      category:        product.category,
      brand:           product.brand,
      compatible_with: product.compatibleWith,
      price:           product.price,
      image:           product.image,
      available:       product.available,
      featured:        product.featured,
      created_at:      product.createdAt,
      updated_at:      product.updatedAt,
    };
    const { error } = await window._sb.from("products").upsert(row, { onConflict: "id" });
    if (error) throw error;
  }

  async function removeProduct(id) {
    const { error } = await window._sb.from("products").delete().eq("id", id);
    if (error) throw error;
  }

  // ─── SUPABASE: categorías ─────────────────────────────────────────────────────
  async function upsertCategory(name) {
    const { error } = await window._sb.from("categories").upsert({ name }, { onConflict: "name" });
    if (error) throw error;
  }

  async function removeCategory(name) {
    const { error } = await window._sb.from("categories").delete().eq("name", name);
    if (error) throw error;
  }

  // ─── CLOUDINARY: subir imagen vía backend seguro ──────────────────────────────
  // Sube la imagen directamente a Supabase Storage (bucket: product-images)
  // No requiere ningún backend externo — usa la sesión autenticada del admin.
  async function uploadImage(file) {
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) throw new Error("Tipo de archivo no permitido. Usa JPG, PNG, WEBP o GIF.");
    if (file.size > 5 * 1024 * 1024)  throw new Error("La imagen supera el límite de 5 MB.");

    // Nombre único: timestamp + nombre original saneado
    const ext      = file.name.split(".").pop().toLowerCase();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
    const path     = `${Date.now()}_${safeName}`;

    const { error } = await window._sb.storage
      .from("product-images")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw new Error(`Error al subir imagen: ${error.message}`);

    const { data } = window._sb.storage
      .from("product-images")
      .getPublicUrl(path);

    if (!data?.publicUrl) throw new Error("No se pudo obtener la URL pública de la imagen.");
    return data.publicUrl;
  }

  // ─── STORE ───────────────────────────────────────────────────────────────────
  function bindStoreEvents() {
    // En catálogo público los filtros disparan búsqueda en Supabase (con debounce en texto)
    if (state.page === "catalog") {
      byId("searchInput")?.addEventListener("input", () => {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(triggerSearch, 400);
      });
      byId("categoryFilter")?.addEventListener("change", triggerSearch);
      byId("brandFilter")?.addEventListener("change", triggerSearch);
      byId("compatibleFilter")?.addEventListener("change", triggerSearch);
      byId("availabilityFilter")?.addEventListener("change", triggerSearch);
      byId("sortFilter")?.addEventListener("change", triggerSearch);
    } else {
      byId("searchInput")?.addEventListener("input", renderProducts);
      byId("categoryFilter")?.addEventListener("change", renderProducts);
      byId("brandFilter")?.addEventListener("change", renderProducts);
      byId("compatibleFilter")?.addEventListener("change", renderProducts);
      byId("availabilityFilter")?.addEventListener("change", renderProducts);
      byId("sortFilter")?.addEventListener("change", renderProducts);
    }
    byId("clearFiltersButton")?.addEventListener("click", clearFilters);
    byId("focusCatalogSearchButton")?.addEventListener("click", () => {
      const input = byId("searchInput");
      input?.focus();
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    byId("backToCatalogButton")?.addEventListener("click", () => closeProductDetail(true));
    byId("closeImageViewerButton")?.addEventListener("click", closeImageViewer);
    byId("closeImageViewerBackdrop")?.addEventListener("click", closeImageViewer);
    window.addEventListener("popstate", syncProductViewFromUrl);
    window.addEventListener("hashchange", syncProductViewFromUrl);
    byId("openCartButton")?.addEventListener("click", openCart);
    byId("closeCartButton")?.addEventListener("click", closeCart);
    byId("cartOverlay")?.addEventListener("click", closeCart);
    byId("appointmentForm")?.addEventListener("submit", sendAppointmentRequest);
  }

  // Lanza la búsqueda en Supabase y actualiza el grid
  let searchToken = 0;

  async function triggerSearch() {
    const token = ++searchToken;
    showSearchSpinner(true);
    await searchInSupabase();
    if (token !== searchToken) return;
    showSearchSpinner(false);
    renderProducts();
  }

  function showSearchSpinner(visible) {
    const count = byId("resultCount");
    if (count && visible) count.textContent = "Buscando…";
  }

  function renderStore() {
    if (state.page === "product") {
      renderProductPage();
      renderCartBadge();
      renderCart();
      return;
    }
    renderStoreFilterOptions();
    applyCatalogUrlParams();
    renderProducts();
    renderCategoryCards();
    syncProductViewFromUrl();
    renderCartBadge();
    renderCart();
    // Mostrar estado inicial
    updateCatalogHeading();
  }

  function updateCatalogHeading() {
    const hint = byId("catalogHint");
    const hasProducts = state.products.length > 0;

    if (!hint) return;

    if (!state.searchMode) {
      hint.hidden = false;
      hint.style.display = "";
      hint.textContent = hasProducts
        ? "Te mostramos algunos destacados. También podés buscar por nombre"
        : "";
    } else {
      hint.hidden = true;
      hint.style.display = "none";
    }
  }

  function renderStoreFilterOptions() {
    // Categorías: cargadas al inicio desde la tabla categories
    fillSelect(byId("categoryFilter"), "Todas", state.categories);
    // Marcas y compatibilidad: se pueblan con los resultados actuales
    fillSelect(byId("brandFilter"),      "Todas", unique(state.products.map(p => p.brand).filter(Boolean)));
    fillSelect(byId("compatibleFilter"), "Todas", unique(state.products.flatMap(p => splitList(p.compatibleWith))));
  }

  function applyCatalogUrlParams() {
    if (state.appliedUrlParams || state.page !== "catalog") return;
    const params   = new URLSearchParams(window.location.search);
    const category = params.get("categoria");
    if (category && byId("categoryFilter")) {
      byId("categoryFilter").value = category;
      triggerSearch();
    }
    state.appliedUrlParams = true;
  }

  function renderProducts() {
    // En catálogo público, state.products ya viene filtrado desde Supabase
    // En otras páginas, filtramos localmente
    const products = state.page === "catalog" ? getLocalFilter(state.products) : getFilteredProducts();
    const grid     = byId("productsGrid");
    const empty    = byId("emptyProducts");
    const result   = byId("resultCount");
    if (!grid) return;
    grid.replaceChildren();
    products.forEach(p => grid.appendChild(createProductCard(p)));

    const showInitialCatalogHint = state.page === "catalog" && !state.searchMode && products.length === 0;
    if (empty) {
      const shouldShowEmpty = products.length === 0 && !showInitialCatalogHint;
      empty.hidden = !shouldShowEmpty;
      empty.style.display = shouldShowEmpty ? "" : "none";
      if (shouldShowEmpty) {
        const title = empty.querySelector("h3");
        const text = empty.querySelector("p");
        if (title) title.textContent = "No encontramos productos con esos filtros";
        if (text) text.textContent = "Probá con otra palabra, categoría o escribinos por WhatsApp.";
      }
    }
    if (result) {
      if (!state.searchMode && state.page === "catalog") {
        result.textContent = products.length > 0 ? `${products.length} destacado${products.length === 1 ? "" : "s"}` : "Catálogo por búsqueda";
      } else {
        result.textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
      }
    }
    renderActiveFilters();
    updateCatalogHeading();
    // Actualizar selectores de marca/compatible con los resultados actuales
    if (state.page === "catalog" && state.searchMode) {
      fillSelect(byId("brandFilter"),      "Todas", unique(state.products.map(p => p.brand).filter(Boolean)));
      fillSelect(byId("compatibleFilter"), "Todas", unique(state.products.flatMap(p => splitList(p.compatibleWith))));
    }
  }

  // Filtro local solo para ordenamiento y filtros de marca/compatible dentro de resultados ya traídos
  function getLocalFilter(products) {
    const sort       = byId("sortFilter")?.value || "featured";
    return [...products].sort((a, b) => sortProducts(a, b, sort));
  }

  function getFilteredProducts() {
    const search       = byId("searchInput")?.value.trim().toLowerCase() || "";
    const category     = byId("categoryFilter")?.value || "all";
    const brand        = byId("brandFilter")?.value || "all";
    const compatible   = byId("compatibleFilter")?.value || "all";
    const availability = byId("availabilityFilter")?.value || "all";
    const sort         = byId("sortFilter")?.value || "featured";
    return [...state.products]
      .filter(p => {
        const text = [p.name,p.code,p.description,p.category,p.brand,p.compatibleWith].join(" ").toLowerCase();
        return (
          (!search || text.includes(search)) &&
          (category    === "all" || p.category === category) &&
          (brand       === "all" || p.brand    === brand) &&
          (compatible  === "all" || splitList(p.compatibleWith).includes(compatible)) &&
          (availability === "all" || (availability === "available" && p.available) || (availability === "unavailable" && !p.available))
        );
      })
      .sort((a, b) => sortProducts(a, b, sort));
  }

  function sortProducts(a, b, sort) {
    if (sort === "name")       return a.name.localeCompare(b.name, "es");
    if (sort === "price-asc")  return a.price - b.price;
    if (sort === "price-desc") return b.price - a.price;
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.name.localeCompare(b.name, "es");
  }

  function createProductCard(product, compact = false) {
    const card      = el("article", compact ? "product-card product-card-compact" : "product-card");
    card.tabIndex   = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Ver detalles de ${product.name}`);
    const imageWrap = el("div", "product-image-wrap");
    const badges    = el("div", "product-badges");
    badges.appendChild(statusPill(product.available));
    if (product.featured) badges.appendChild(tag("Destacado", "featured-badge"));
    {
      const img = el("img");
      img.src = getProductImage(product);
      img.alt = product.name;
      img.loading = "lazy";
      if (isStockImage(product)) img.classList.add("stock-image");
      imageWrap.appendChild(img);
    }
    imageWrap.appendChild(badges);
    const body = el("div", "product-body");
    body.appendChild(el("span", "product-category", product.category));
    if (product.brand) body.appendChild(el("span", "product-brand", product.brand));
    body.appendChild(el("h3", "", product.name));
    body.appendChild(el("p", "product-description", product.description || "Descripcion pendiente."));
    const meta = el("div", "product-meta");
    if (product.code) meta.appendChild(el("span", "", `Ref: ${product.code}`));
    body.appendChild(meta);
    const footer = el("div", "product-footer");
    const clientPrice = typeof window.getClientPrice === "function" ? window.getClientPrice(product) : null;
    if (clientPrice !== null && clientPrice !== product.price) {
      const origSpan = el("span", "price-original", formatMoney(product.price));
      const discSpan = el("strong", "price", formatMoney(clientPrice));
      footer.appendChild(origSpan);
      footer.appendChild(discSpan);
    } else {
      footer.appendChild(el("strong", "price", formatMoney(product.price)));
    }
    const button = el("button", "btn-primary", product.available ? "Agregar" : "Consultar");
    button.type = "button";
    button.addEventListener("click", (event) => { event.stopPropagation(); addToCart(product.id); });
    footer.appendChild(button);
    body.appendChild(footer);
    card.append(imageWrap, body);
    card.addEventListener("click", () => goToProductPage(product.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        goToProductPage(product.id);
      }
    });
    return card;
  }

  function syncProductViewFromUrl() {
    if (state.page !== "catalog") return;
    const params = new URLSearchParams(window.location.search);
    const hashId = window.location.hash.startsWith("#producto-") ? decodeURIComponent(window.location.hash.replace("#producto-", "")) : "";
    const id = params.get("producto") || hashId;
    if (id) goToProductPage(id);
    else closeProductDetail(false);
  }

  function openProductDetail(id, push = true) {
    goToProductPage(id);
  }

  function goToProductPage(id) {
    if (!id) return;
    window.location.href = productPageUrl(id);
  }

  function productPageUrl(id) {
    return `producto.html?id=${encodeURIComponent(id)}`;
  }

  function renderProductPage() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id") || params.get("producto");
    const title = byId("productPageTitle");
    const product = state.products.find(p => String(p.id) === String(id));

    byId("backToCatalogButton")?.addEventListener("click", () => {
      window.location.href = "catalogo.html";
    });

    if (!product) {
      if (title) title.textContent = "Producto no encontrado";
      const shell = byId("productDetailShell");
      if (shell) {
        const empty = el("div", "empty-state product-empty-state");
        const a = el("a", "btn-primary", "Volver al catalogo");
        a.href = "catalogo.html";
        empty.append(
          el("h3", "", "No encontramos este producto"),
          el("p", "", "Puede que el enlace haya cambiado o que el producto ya no esté disponible."),
          a
        );
        shell.replaceChildren(empty);
      }
      const similar = byId("similarProductsSection");
      if (similar) similar.hidden = true;
      return;
    }

    state.viewingProductId = product.id;
    document.title = `${product.name} | Herrera Auto Partes`;
    if (title) title.textContent = product.name;
    renderProductDetail(product);
  }

  function closeProductDetail(push = true) {
    if (state.page !== "catalog") return;
    state.viewingProductId = "";
    toggleCatalogDetail(false);
    closeImageViewer();
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.delete("producto");
      url.hash = "";
      history.pushState({}, "", url);
    }
  }

  function toggleCatalogDetail(showDetail) {
    const ids = ["productsGrid", "activeFilters", "emptyProducts"];
    ids.forEach(id => { const node = byId(id); if (node) node.hidden = showDetail || (id === "emptyProducts" && getFilteredProducts().length > 0); });
    const filters = byId("catalogFilters") || document.querySelector(".catalog-filter-bar");
    if (filters) filters.hidden = showDetail;
    const detail = byId("productDetailView");
    if (detail) detail.hidden = !showDetail;
    const result = byId("resultCount");
    if (result && showDetail) result.textContent = "Vista de producto";
    if (result && !showDetail) {
      const products = getFilteredProducts();
      result.textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
    }
  }

  function renderProductDetail(product) {
    const shell = byId("productDetailShell");
    if (!shell) return;
    const imageBox = el("div", "product-detail-image-box");
    {
      const imgSrc = getProductImage(product);
      const stock  = isStockImage(product);
      const imageButton = el("button", "product-detail-image-button");
      imageButton.type = "button";
      imageButton.setAttribute("aria-label", "Ver imagen ampliada");
      if (stock) imageButton.classList.add("stock-image-button");
      const img = el("img"); img.src = imgSrc; img.alt = product.name;
      if (stock) img.classList.add("stock-image");
      imageButton.appendChild(img);
      if (!stock) {
        imageButton.addEventListener("click", () => openImageViewer(imgSrc, product.name));
        imageBox.appendChild(imageButton);
        imageBox.appendChild(el("span", "image-help-text", "Toca la imagen para verla más grande"));
      } else {
        imageButton.style.cursor = "default";
        imageBox.appendChild(imageButton);
        imageBox.appendChild(el("span", "image-help-text stock-badge", "Imagen referencial de categoría"));
      }
    }

    const info = el("div", "product-detail-info");
    const topRow = el("div", "product-detail-tags");
    topRow.appendChild(statusPill(product.available));
    if (product.featured) topRow.appendChild(tag("Destacado", "featured-badge"));
    if (product.category) topRow.appendChild(tag(product.category));
    info.appendChild(topRow);
    info.appendChild(el("h1", "", product.name));
    if (product.brand) info.appendChild(el("p", "product-detail-subtitle", product.brand));
    info.appendChild(el("p", "product-detail-description", product.description || "Descripción pendiente. Puedes consultar más información por WhatsApp."));

    const specs = el("div", "product-detail-specs");
    const clientPriceDetail = typeof window.getClientPrice === "function" ? window.getClientPrice(product) : null;
    if (clientPriceDetail !== null && clientPriceDetail !== product.price) {
      const priceNode = document.createElement("div");
      priceNode.innerHTML = `<span class="price-original">${formatMoney(product.price)}</span><strong>${formatMoney(clientPriceDetail)}</strong>`;
      specs.appendChild(detailSpec("Precio", "", priceNode));
    } else {
      specs.appendChild(detailSpec("Precio", formatMoney(product.price)));
    }
    if (product.brand) specs.appendChild(detailSpec("Presentación", product.brand));
    specs.appendChild(detailSpec("Referencia", product.code || "No indicada"));
    specs.appendChild(detailSpec("Estado", product.available ? "Disponible" : "Por consultar"));
    info.appendChild(specs);

    const actions = el("div", "product-detail-actions");
    const cartButton = el("button", "btn-primary", product.available ? "Agregar al carrito" : "Agregar para consultar");
    cartButton.type = "button";
    cartButton.addEventListener("click", () => addToCart(product.id));
    const waButton = el("button", "btn-whatsapp", "Más información por WhatsApp");
    waButton.type = "button";
    waButton.addEventListener("click", () => sendWhatsAppProduct(product));
    actions.append(cartButton, waButton);
    info.appendChild(actions);

    shell.replaceChildren(imageBox, info);
    renderSimilarProducts(product);
  }

  function detailSpec(label, value) {
    const item = el("div", "detail-spec");
    item.append(el("span", "", label), el("strong", "", value));
    return item;
  }

  function renderSimilarProducts(product) {
    const section = byId("similarProductsSection");
    const grid = byId("similarProductsGrid");
    if (!section || !grid) return;
    const similar = getSimilarProducts(product).slice(0, 4);
    section.hidden = similar.length === 0;
    grid.replaceChildren(...similar.map(p => createProductCard(p, true)));
  }

  function getSimilarProducts(product) {
    const productCompat = splitList(product.compatibleWith);
    const nameWords = String(product.name || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
    return state.products
      .filter(p => p.id !== product.id)
      .map(p => {
        const compat = splitList(p.compatibleWith);
        let score = 0;
        if (p.category && p.category === product.category) score += 5;
        if (p.brand && product.brand && p.brand === product.brand) score += 3;
        if (compat.some(c => productCompat.includes(c))) score += 4;
        if (nameWords.some(w => String(p.name || "").toLowerCase().includes(w))) score += 2;
        if (p.available) score += 1;
        if (p.featured) score += 1;
        return { ...p, similarityScore: score };
      })
      .filter(p => p.similarityScore > 0)
      .sort((a, b) => b.similarityScore - a.similarityScore || sortProducts(a, b, "featured"));
  }

  function sendWhatsAppProduct(product) {
    const message = [
      "Hola, quisiera más información sobre este producto:",
      "",
      `Producto: ${product.name}`,
      `Precio visto: ${formatMoney(typeof window.getClientPrice === "function" && window.getClientPrice(product) !== null ? window.getClientPrice(product) : product.price)}`,
      `Presentación: ${product.brand || "Ver en tienda"}`,
      `Referencia: ${product.code || "No indicada"}`,
      "",
      "¿Me pueden confirmar disponibilidad y detalles?"
    ].join("\n");
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  function openImageViewer(src, alt) {
    const viewer = byId("imageViewer");
    const img = byId("imageViewerImg");
    if (!viewer || !img || !src) return;
    img.src = src;
    img.alt = alt || "Imagen del producto ampliada";
    viewer.hidden = false;
    viewer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeImageViewer() {
    const viewer = byId("imageViewer");
    const img = byId("imageViewerImg");
    if (!viewer) return;
    viewer.hidden = true;
    viewer.setAttribute("aria-hidden", "true");
    if (img) img.src = "";
    if (!byId("mobileNav")?.classList.contains("is-open") && !byId("cartDrawer")?.classList.contains("open")) document.body.style.overflow = "";
  }

  function renderActiveFilters() {
    const row = byId("activeFilters");
    if (!row) return;
    const filters = [];
    const search       = byId("searchInput")?.value.trim();
    const category     = byId("categoryFilter")?.value;
    const brand        = byId("brandFilter")?.value;
    const compatible   = byId("compatibleFilter")?.value;
    const availability = byId("availabilityFilter")?.value;
    if (search) filters.push(`Busqueda: ${search}`);
    if (category   && category   !== "all") filters.push(category);
    if (brand      && brand      !== "all") filters.push(`Sabor: ${brand}`);
    if (compatible && compatible !== "all") filters.push(`Presentación: ${compatible}`);
    if (availability === "available")   filters.push("Disponibles");
    if (availability === "unavailable") filters.push("No disponibles");
    row.replaceChildren(...filters.map(f => tag(f)));
  }

  function clearFilters() {
    byId("searchInput").value        = "";
    byId("categoryFilter").value     = "all";
    byId("brandFilter").value        = "all";
    byId("compatibleFilter").value   = "all";
    byId("availabilityFilter").value = "all";
    byId("sortFilter").value         = "featured";
    if (state.page === "catalog") {
      triggerSearch();
    } else {
      renderProducts();
    }
  }

  function renderCategoryCards() {
    const grid = byId("categoryCards");
    if (!grid) return;
    const cards = state.categories.map(category => {
      const products  = state.products.filter(p => p.category === category);
      const available = products.filter(p => p.available).length;
      const card      = el("a", "category-card");
      card.href       = `catalogo.html?categoria=${encodeURIComponent(category)}`;
      card.append(
        el("span", "section-kicker", category),
        el("strong", "", `${products.length} producto${products.length === 1 ? "" : "s"}`),
        el("p", "", `${available} disponible${available === 1 ? "" : "s"} para cotizar ahora.`)
      );
      return card;
    });
    grid.replaceChildren(...cards);
  }

  // ─── CARRITO (localStorage) ───────────────────────────────────────────────────
  function addToCart(id) {
    const product  = state.products.find(p => p.id === id);
    if (!product) return;
    const existing = state.cart.find(p => p.id === id);
    if (existing) existing.qty += 1;
    else state.cart.push({ id, qty: 1 });
    saveCart(); renderCartBadge(); renderCart(); openCart();
    toast(product.available ? "Producto agregado al carrito." : "Producto agregado para consultar disponibilidad.", "success");
  }

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return saved.map(i => ({ id: i.id, qty: Number(i.qty || 1) })).filter(i => i.id && i.qty > 0);
    } catch { return []; }
  }

  function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); }

  function renderCartBadge() {
    const badge = byId("cartBadge");
    if (badge) badge.textContent = state.cart.reduce((s, i) => s + i.qty, 0);
  }

  function renderCart() {
    const body   = byId("cartBody");
    const footer = byId("cartFooter");
    if (!body || !footer) return;
    const lines = state.cart.map(line => { const p = state.products.find(x => x.id === line.id); return p ? { ...p, qty: line.qty } : null; }).filter(Boolean);
    body.replaceChildren();
    if (!lines.length) {
      body.appendChild(el("div", "empty-state", "Tu carrito esta vacio."));
      footer.replaceChildren(totalRow(0), el("p", "quote-note", "Agrega productos para solicitar una cotizacion por WhatsApp."), disabledButton("Cotizar por WhatsApp"));
      return;
    }
    lines.forEach(line => body.appendChild(createCartLine(line)));
    const total       = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const quoteButton = el("button", "btn-primary", "Enviar cotizacion por WhatsApp");
    quoteButton.type  = "button";
    quoteButton.addEventListener("click", sendWhatsAppQuote);
    footer.replaceChildren(totalRow(total), el("p", "quote-note", "La cotizacion se enviara al WhatsApp 8737-0327."), quoteButton);
  }

  function createCartLine(line) {
    const item = el("article", "cart-line");
    if (line.image) { const img = el("img"); img.src = line.image; img.alt = line.name; item.appendChild(img); }
    else { item.appendChild(el("div", "cart-line-placeholder")); }
    const info = el("div");
    info.appendChild(el("h3", "", line.name));
    info.appendChild(el("p", "", `${line.available ? "Disponible" : "Por consultar"} / ${line.brand || "Sin presentación"}`));
    const qty = el("div", "qty-row");
    const minus = el("button","","-"); const plus = el("button","","+");
    minus.type = plus.type = "button";
    minus.addEventListener("click", () => changeCartQty(line.id, -1));
    plus.addEventListener("click",  () => changeCartQty(line.id,  1));
    qty.append(minus, el("span","",String(line.qty)), plus);
    info.appendChild(qty);
    const remove = el("button","icon-button","x"); remove.type = "button";
    remove.addEventListener("click", () => removeFromCart(line.id));
    item.append(info, remove);
    return item;
  }

  function changeCartQty(id, delta) {
    state.cart = state.cart.map(i => i.id === id ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0);
    saveCart(); renderCartBadge(); renderCart();
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter(i => i.id !== id);
    saveCart(); renderCartBadge(); renderCart();
  }

  function openCart()  { byId("cartDrawer")?.classList.add("open");    byId("cartDrawer")?.setAttribute("aria-hidden","false"); }
  function closeCart() { byId("cartDrawer")?.classList.remove("open"); byId("cartDrawer")?.setAttribute("aria-hidden","true"); }

  function sendWhatsAppQuote() {
    const lines = state.cart.map(l => { const p = state.products.find(x => x.id === l.id); return p ? { ...p, qty: l.qty } : null; }).filter(Boolean);
    if (!lines.length) return;
    const total   = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const detail  = lines.map(l => `- ${l.qty} x ${l.name} (${l.brand || "Sin presentación"}) - ${l.available ? "Disponible" : "Solicitar disponibilidad"} - ${formatMoney(l.price * l.qty)}`).join("\n");
    const message = `Hola, quisiera solicitar una cotizacion en Herrera Auto Partes:\n\n${detail}\n\nTotal estimado: ${formatMoney(total)}\n\nPor favor confirmar disponibilidad y precio final.`;
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  function sendAppointmentRequest(event) {
    event.preventDefault();
    const name        = clean(byId("appointmentName")?.value);
    const phone       = clean(byId("appointmentPhone")?.value);
    const vehicleType = clean(byId("appointmentVehicleType")?.value);
    const vehicle     = clean(byId("appointmentVehicle")?.value);
    const plate       = clean(byId("appointmentPlate")?.value);
    const date        = clean(byId("appointmentDate")?.value);
    const service     = clean(byId("appointmentService")?.value);
    const notes       = clean(byId("appointmentNotes")?.value);
    if (!name || !phone || !vehicleType || !vehicle || !service) { toast("Completa los datos requeridos.", "error"); return; }
    const message = ["Hola, quisiera solicitar una cita en Taller del Este:","",`Nombre: ${name}`,`Telefono: ${phone}`,`Tipo de vehiculo: ${vehicleType}`,`Marca, modelo y ano: ${vehicle}`,`Placa: ${plate || "No indicada"}`,`Servicio requerido: ${service}`,`Fecha deseada: ${date || "Por coordinar"}`,`Comentarios: ${notes || "Sin comentarios adicionales"}`,"","Por favor confirmar disponibilidad y proximos pasos."].join("\n");
    toast("Solicitud de cita lista para WhatsApp.", "success");
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  // ─── ADMIN ────────────────────────────────────────────────────────────────────
  function bindAdminEvents() {
    document.querySelectorAll("[data-admin-page]").forEach(button => {
      button.addEventListener("click", () => showAdminPage(button.dataset.adminPage, button));
    });
    document.querySelectorAll("[data-admin-page-shortcut]").forEach(button => {
      button.addEventListener("click", () => {
        const page = button.dataset.adminPageShortcut;
        showAdminPage(page, document.querySelector(`[data-admin-page="${page}"]`));
      });
    });
    byId("newProductButton")?.addEventListener("click", () => openProductDialog());
    byId("newCategoryButton")?.addEventListener("click", () => openDialog("categoryDialog"));
    byId("productForm")?.addEventListener("submit", saveProductFromForm);
    byId("categoryForm")?.addEventListener("submit", saveCategoryFromForm);
    byId("imageInput")?.addEventListener("change", handleImageInput);
    byId("adminSearch")?.addEventListener("input", renderProductsTable);
    byId("adminCategoryFilter")?.addEventListener("change", renderProductsTable);
    byId("adminStatusFilter")?.addEventListener("change", renderProductsTable);
    byId("exportExcelButton")?.addEventListener("click", exportExcel);
    byId("downloadTemplateButton")?.addEventListener("click", downloadExcelTemplate);
    byId("excelInput")?.addEventListener("change", importExcel);
    document.querySelectorAll("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
    });
  }

  function renderAdmin() {
    renderAdminCategoryOptions();
    renderDashboard();
    renderProductsTable();
    renderCategoriesTable();
  }

  function showAdminPage(page, button) {
    document.querySelectorAll(".admin-page").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    byId(`page-${page}`)?.classList.add("active");
    button?.classList.add("active");
    byId("adminPageTitle").textContent = { dashboard:"Dashboard", products:"Productos", categories:"Categorias", codes:"Códigos cliente", excel:"Excel" }[page] || "Dashboard";
    renderAdmin();
  }

  function renderDashboard() {
    const stats = byId("statsGrid");
    if (!stats) return;
    const total       = state.products.length;
    const available   = state.products.filter(p => p.available).length;
    const unavailable = total - available;
    const featured    = state.products.filter(p => p.featured).length;
    const categories  = unique(state.products.map(p => p.category)).length;
    stats.replaceChildren(
      statCard("Total productos", total, "en catalogo"),
      statCard("Disponibles",    available,   "para cotizar ahora"),
      statCard("No disponibles", unavailable, "por consultar"),
      statCard("Destacados",     featured,    "visibles primero"),
      statCard("Categorias",     categories,  "en uso")
    );
    renderCompactList("unavailableList", state.products.filter(p => !p.available).slice(0, 6));
    renderCompactList("featuredList",    state.products.filter(p => p.featured).slice(0, 6));
    byId("unavailableCountLabel").textContent = `${unavailable} producto${unavailable === 1 ? "" : "s"}`;
    byId("featuredCountLabel").textContent    = `${featured} producto${featured === 1 ? "" : "s"}`;
    renderRecentTable();
  }

  function statCard(label, value, note) {
    const card = el("article", "stat-card");
    card.append(el("span","",label), el("strong","",String(value)), el("small","",note));
    return card;
  }

  function renderCompactList(id, products) {
    const list = byId(id);
    if (!list) return;
    if (!products.length) { list.replaceChildren(el("p","panel-note","No hay productos en esta lista.")); return; }
    list.replaceChildren(...products.map(p => {
      const item = el("div","compact-item");
      const text = el("div");
      text.append(el("strong","",p.name), el("span","",`${p.category} / ${p.brand || "Sin presentación"}`));
      item.append(text, statusPill(p.available));
      return item;
    }));
  }

  function renderRecentTable() {
    const body = byId("recentProductsBody");
    if (!body) return;
    const recent = [...state.products].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6);
    body.replaceChildren(...recent.map(p => createProductRow(p, false)));
  }

  function renderProductsTable() {
    const body = byId("productsTableBody");
    if (!body) return;
    renderAdminCategoryOptions();
    const search   = byId("adminSearch")?.value.trim().toLowerCase() || "";
    const category = byId("adminCategoryFilter")?.value || "all";
    const status   = byId("adminStatusFilter")?.value || "all";
    const products = state.products.filter(p => {
      const ok_search   = !search || [p.name,p.code,p.brand,p.category].join(" ").toLowerCase().includes(search);
      const ok_category = category === "all" || p.category === category;
      const ok_status   = status   === "all" || (status === "available" && p.available) || (status === "unavailable" && !p.available);
      return ok_search && ok_category && ok_status;
    });
    body.replaceChildren(...products.map(p => createProductRow(p, true)));
  }

  function createProductRow(product, withActions) {
    const row         = el("tr");
    const productCell = el("td");
    const productWrap = el("div","td-product");
    if (product.image) { const img = el("img"); img.src = product.image; img.alt = product.name; productWrap.appendChild(img); }
    else { const img = el("img"); img.src = getProductImage(product); img.alt = product.name; img.classList.add("stock-image"); productWrap.appendChild(img); }
    const productText = el("div");
    productText.append(el("strong","",product.name), el("small","",product.code || "Sin referencia"));
    productWrap.appendChild(productText);
    productCell.appendChild(productWrap);
    row.append(productCell, td(product.category||"-"), td(product.brand||"-"));
    if (!withActions) { row.append(tdNode(statusPill(product.available)), td(formatMoney(product.price))); return row; }
    row.append(td(product.featured?"Si":"No"), tdNode(statusPill(product.available)), td(formatMoney(product.price)));
    const actions = el("td"); const wrap = el("div","table-actions");
    const edit   = el("button","","Editar");
    const toggle = el("button","", product.available ? "Marcar no disponible" : "Marcar disponible");
    const feat   = el("button","", product.featured  ? "Quitar destacado"    : "Destacar");
    const remove = el("button","danger","Borrar");
    edit.type = toggle.type = feat.type = remove.type = "button";
    edit.addEventListener(  "click", () => openProductDialog(product.id));
    toggle.addEventListener("click", () => toggleAvailability(product.id));
    feat.addEventListener(  "click", () => toggleFeatured(product.id));
    remove.addEventListener("click", () => deleteProduct(product.id));
    wrap.append(edit, toggle, feat, remove);
    actions.appendChild(wrap); row.appendChild(actions);
    return row;
  }

  function renderCategoriesTable() {
    const body = byId("categoriesTableBody");
    if (!body) return;
    body.replaceChildren(...state.categories.map(category => {
      const row     = el("tr");
      const count   = state.products.filter(p => p.category === category).length;
      const actions = el("td");
      const button  = el("button","btn-muted","Eliminar");
      button.type = "button"; button.disabled = count > 0;
      button.addEventListener("click", () => deleteCategory(category));
      actions.appendChild(button);
      row.append(td(category), td(`${count} producto${count===1?"":"s"}`), actions);
      return row;
    }));
  }

  function renderAdminCategoryOptions() {
    fillSelect(byId("adminCategoryFilter"), "Todas", state.categories);
    const categoryInput = byId("categoryInput");
    if (categoryInput) {
      const current = categoryInput.value;
      fillSelect(categoryInput, "Seleccionar", state.categories, "");
      categoryInput.value = current || "";
    }
  }

  // ─── DIALOGO PRODUCTO ─────────────────────────────────────────────────────────
  function openProductDialog(id = "") {
    state.editingProductId = id; state.imageDraft = ""; state.imageDraftFile = null;
    const product = state.products.find(p => p.id === id);
    byId("productDialogTitle").textContent = product ? "Editar producto" : "Nuevo producto";
    byId("productId").value          = product?.id || "";
    byId("nameInput").value          = product?.name || "";
    byId("codeInput").value          = product?.code || "";
    byId("descriptionInput").value   = product?.description || "";
    
    
    byId("presentationInput").value  = product?.brand || "";
    byId("priceInput").value         = product?.price || "";
    byId("availableInput").value     = String(product?.available ?? true);
    byId("featuredInput").checked    = Boolean(product?.featured);
    renderAdminCategoryOptions();
    byId("categoryInput").value      = product?.category || "";
    const preview = byId("imagePreview");
    preview.hidden = !product?.image; preview.src = product?.image || "";
    byId("imageInput").value = "";
    openDialog("productDialog");
  }

  async function saveProductFromForm(event) {
    event.preventDefault();
    const id       = byId("productId").value || makeId();
    const existing = state.products.find(p => p.id === id);
    const category = clean(byId("categoryInput").value);
    if (!category) { toast("Selecciona una categoria.", "error"); return; }
    const saveBtn  = event.submitter;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Guardando…"; }
    try {
      let imageUrl = state.imageDraft || existing?.image || "";
      if (state.imageDraftFile) { toast("Subiendo imagen…"); imageUrl = await uploadImage(state.imageDraftFile); }
      const now     = new Date().toISOString();
      const product = {
        id, name: clean(byId("nameInput").value), code: clean(byId("codeInput").value),
        description: clean(byId("descriptionInput").value), category,
        brand: clean(byId("presentationInput").value), compatibleWith: "",
        price: Number(byId("priceInput").value || 0), image: imageUrl,
        available: byId("availableInput").value === "true", featured: byId("featuredInput").checked,
        createdAt: existing?.createdAt || now, updatedAt: now,
      };
      if (!product.name || product.price < 0) { toast("Revisa nombre y precio.", "error"); return; }
      // Crear la categoría primero si no existe (evita error de foreign key)
      if (!state.categories.includes(category)) { await upsertCategory(category); state.categories = unique([...state.categories, category]); }
      await upsertProduct(product);
      if (existing) state.products = state.products.map(p => p.id === id ? product : p);
      else state.products.push(product);
      closeDialog("productDialog"); renderAdmin();
      toast(existing ? "Producto actualizado." : "Producto creado.", "success");
    } catch (err) { console.error(err); toast("Error al guardar. Intenta de nuevo.", "error"); }
    finally { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Guardar"; } }
  }

  function handleImageInput(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("La imagen no debe superar 5MB.", "error"); event.target.value = ""; return; }
    state.imageDraftFile = file;
    const url = URL.createObjectURL(file);
    state.imageDraft = url;
    const preview = byId("imagePreview");
    preview.src = url; preview.hidden = false;
  }

  async function saveCategoryFromForm(event) {
    event.preventDefault();
    const name = clean(byId("categoryNameInput").value);
    if (!name) return;
    if (state.categories.includes(name)) { toast("Esa categoria ya existe.", "error"); return; }
    try {
      await upsertCategory(name);
      state.categories = unique([...state.categories, name]);
      byId("categoryNameInput").value = ""; closeDialog("categoryDialog"); renderAdmin();
      toast("Categoria creada.", "success");
    } catch { toast("Error al crear categoria.", "error"); }
  }

  async function deleteCategory(category) {
    const productsWithCat = state.products.filter(p => p.category === category);
    if (productsWithCat.length > 0) {
      toast(`No se puede eliminar "${category}": tiene ${productsWithCat.length} producto(s) asignado(s). Reasignalos primero.`, "error");
      return;
    }
    if (!confirm(`¿Eliminar la categoría "${category}"?`)) return;
    try {
      await removeCategory(category);
      state.categories = state.categories.filter(c => c !== category);
      renderAdmin();
      toast(`Categoría "${category}" eliminada.`, "success");
    } catch(e) {
      toast("Error al eliminar: " + (e?.message || "intenta de nuevo"), "error");
    }
  }

  async function toggleAvailability(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    const updated = { ...product, available: !product.available, updatedAt: new Date().toISOString() };
    try { await upsertProduct(updated); state.products = state.products.map(p => p.id === id ? updated : p); renderAdmin(); }
    catch { toast("Error al actualizar disponibilidad.", "error"); }
  }

  async function toggleFeatured(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    const updated = { ...product, featured: !product.featured, updatedAt: new Date().toISOString() };
    try { await upsertProduct(updated); state.products = state.products.map(p => p.id === id ? updated : p); renderAdmin(); }
    catch { toast("Error al actualizar destacado.", "error"); }
  }

  async function deleteProduct(id) {
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    if (!confirm(`Eliminar "${product.name}"?`)) return;
    try {
      await removeProduct(id);
      state.products = state.products.filter(p => p.id !== id);
      state.cart     = state.cart.filter(p => p.id !== id);
      saveCart(); renderAdmin(); toast("Producto eliminado.");
    } catch { toast("Error al eliminar producto.", "error"); }
  }

  // ─── EXCEL ────────────────────────────────────────────────────────────────────
  function exportExcel() {
    const rows = state.products.map(productToExcelRow);
    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Productos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.categories.map(Categoria => ({ Categoria }))), "Categorias");
      XLSX.writeFile(wb, `jugos-del-este-productos-${dateStamp()}.xlsx`);
      toast("Archivo Excel exportado.", "success"); return;
    }
    downloadText(toCsv(rows), `jugos-del-este-productos-${dateStamp()}.csv`, "text/csv");
    toast("Se exportó como CSV.", "success");
  }

  function downloadExcelTemplate() {
    const rows = [
      {
        Nombre: "Pulpa de Maracuyá 1 Kg",
        Descripcion: "Pulpa congelada 100% natural sin conservantes",
        Categoria: "Pulpas congeladas",
        Presentacion: "Pulpa 1 Kg",
        Precio: 2500,
        Disponible: "Si",
        Destacado: "Si",
        Codigo: "PUL-MARA-1KG",
      },
      {
        Nombre: "Galón de Maracuyá",
        Descripcion: "Galón natural sin conservantes ni aditivos",
        Categoria: "Galones",
        Presentacion: "Galón",
        Precio: 6500,
        Disponible: "Si",
        Destacado: "No",
        Codigo: "GAL-MARA-1GAL",
      },
    ];
    if (window.XLSX) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Productos");
      XLSX.writeFile(wb, "plantilla-jugos-del-este.xlsx");
      return;
    }
    downloadText(toCsv(rows), "plantilla-jugos-del-este.csv", "text/csv");
  }

  async function importExcel(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const rows     = readRowsFromFile(file, reader.result);
        const imported = rows.map(excelRowToProduct).filter(p => p.name);
        if (!imported.length) { toast("No se encontraron productos válidos.", "error"); return; }

        // 1. Crear todas las categorías nuevas PRIMERO (evita error de foreign key)
        const newCats = [...new Set(imported.map(p => p.category).filter(Boolean))]
          .filter(c => !state.categories.includes(c));
        for (const cat of newCats) {
          await upsertCategory(cat);
          state.categories = unique([...state.categories, cat]);
        }

        // 2. Insertar productos en lotes pequeños para evitar timeouts
        const BATCH_SIZE = 50;
        const total      = imported.length;
        let   done       = 0;
        toast(`Importando ${total} productos…`);

        for (let i = 0; i < total; i += BATCH_SIZE) {
          const batch     = imported.slice(i, i + BATCH_SIZE);
          const batchRows = batch.map(p => ({
            id: p.id, name: p.name, code: p.code,
            description: p.description, category: p.category,
            brand: p.brand, compatible_with: "",
            price: p.price, image: p.image,
            available: p.available, featured: p.featured,
            created_at: p.createdAt, updated_at: p.updatedAt,
          }));

          const { error } = await window._sb
            .from("products")
            .upsert(batchRows, { onConflict: "id" });
          if (error) throw error;

          done += batch.length;
          toast(`Progreso: ${done} / ${total}…`);
        }

        await loadFromSupabase();
        renderAdmin();
        toast(`${total} producto${total===1?"":"s"} importado${total===1?"":"s"} correctamente.`, "success");
      } catch (err) { toast("Error al importar. Revisá la consola.", "error"); console.error(err); }
      finally { event.target.value = ""; }
    };
    if (window.XLSX) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  }

  function readRowsFromFile(file, result) {
    if (window.XLSX) { const wb = XLSX.read(result, { type:"array" }); return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" }); }
    return csvToRows(String(result));
  }

  function productToExcelRow(p) {
    return {
      ID: p.id, Nombre: p.name, Descripcion: p.description,
      Categoria: p.category, Presentacion: p.brand,
      Precio: p.price, Disponible: p.available?"Si":"No",
      Destacado: p.featured?"Si":"No", Codigo: p.code, Imagen: p.image,
    };
  }

  function excelRowToProduct(row) {
    const now = new Date().toISOString();
    return normalizeProducts([{
      id:           getCell(row, ["ID","Id","id"]) || makeId(),
      name:         getCell(row, ["Nombre","Producto","name"]),
      description:  getCell(row, ["Descripcion","descripcion","Descripción"]),
      category:     getCell(row, ["Categoria","categoria","Categoría"]) || "Pulpas congeladas",
      brand:        getCell(row, ["Presentacion","presentacion","Presentación","Marca","marca"]),
      compatibleWith: "",
      price:        getCell(row, ["Precio","precio"]) || 0,
      available:    getCell(row, ["Disponible","available"]),
      featured:     getCell(row, ["Destacado","featured"]),
      code:         getCell(row, ["Codigo","Code","Referencia","codigo"]),
      image:        getCell(row, ["Imagen","Image","imagen"]),
      createdAt: now, updatedAt: now,
    }])[0];
  }

  function getCell(row, names) {
    const key = names.find(n => Object.prototype.hasOwnProperty.call(row, n));
    return key ? row[key] : "";
  }

  // ─── UTILIDADES UI ────────────────────────────────────────────────────────────
  function openDialog(id)  { byId(id)?.showModal?.(); }
  function closeDialog(id) { const d = byId(id); if (d?.open) d.close(); }
  function totalRow(total) { const row = el("div","total-row"); row.append(el("span","","Total estimado"), el("strong","",formatMoney(total))); return row; }
  function disabledButton(text) { const b = el("button","btn-muted",text); b.type="button"; b.disabled=true; return b; }

  function fillSelect(select, firstLabel, values, firstValue = "all") {
    if (!select) return;
    const current = select.value;
    select.replaceChildren(new Option(firstLabel, firstValue));
    values.filter(Boolean).forEach(v => select.add(new Option(v, v)));
    if ([...select.options].some(o => o.value === current)) select.value = current;
  }

  function statusPill(available) { return tag(available ? "Disponible" : "No disponible", available ? "status-pill available" : "status-pill unavailable"); }
  function tag(text, className="tag") { return el("span", className, text); }
  function td(text) { return el("td","",text); }
  function tdNode(node) { const cell = el("td"); cell.appendChild(node); return cell; }

  function el(tagName, className="", text="") {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }

  function byId(id) { return document.getElementById(id); }

  // ─── UTILIDADES TEXTO / DATOS ─────────────────────────────────────────────────
  function clean(v)     { return String(v || "").trim().replace(/\s+/g," "); }
  function splitList(v) { return clean(v).split(",").map(clean).filter(Boolean); }
  function arrayToList(v) { return Array.isArray(v) ? v.join(", ") : ""; }
  function unique(values) { return [...new Set(values.map(clean).filter(Boolean))].sort((a,b) => a.localeCompare(b,"es")); }

  function parseBool(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const n = String(value).trim().toLowerCase();
    if (["si","s","yes","true","1","disponible","available","destacado"].includes(n)) return true;
    if (["no","n","false","0","no disponible","unavailable","agotado"].includes(n))   return false;
    return fallback;
  }

  function normalizeProducts(products) {
    return products.map(p => {
      const now = new Date().toISOString();
      return {
        id:            p.id || makeId(),
        name:          clean(p.name || p.nombre || "Producto sin nombre"),
        code:          clean(p.code || p.codigo || ""),
        description:   clean(p.description || p.descripcion || ""),
        category:      clean(p.category || p.categoria || "Motor"),
        brand:         clean(p.brand || p.marca || ""),
        compatibleWith:clean(p.compatibleWith || p.compatible_with || p.compatible || arrayToList(p.compatibleBrands)),
        price:         Number(p.price || p.precio || 0),
        image:         p.image || p.imagen || "",
        available:     parseBool(p.available ?? p.disponible ?? true, true),
        featured:      parseBool(p.featured  ?? p.destacado  ?? false, false),
        createdAt:     p.createdAt || p.created_at || now,
        updatedAt:     p.updatedAt || p.updated_at || now,
      };
    });
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("es-CR", { style:"currency", currency:"CRC", maximumFractionDigits:0 }).format(Number(value || 0));
  }

  function makeId() { return window.crypto?.randomUUID ? crypto.randomUUID() : `p_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
  function dateStamp() { return new Date().toISOString().slice(0,10); }

  function toCsv(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [headers.join(","), ...rows.map(row => headers.map(h => csvCell(row[h])).join(","))].join("\n");
  }

  function csvCell(v) { const t = String(v ?? ""); return `"${t.replace(/"/g,'""')}"`; }

  function csvToRows(csv) {
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = parseCsvLine(lines[0]);
    return lines.slice(1).map(line => { const values = parseCsvLine(line); return headers.reduce((row,h,i) => { row[h] = values[i]||""; return row; }, {}); });
  }

  function parseCsvLine(line) {
    const result = []; let current = ""; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i], next = line[i+1];
      if (char==='"' && quoted && next==='"') { current+='"'; i++; }
      else if (char==='"') { quoted=!quoted; }
      else if (char==="," && !quoted) { result.push(current); current=""; }
      else { current+=char; }
    }
    result.push(current); return result;
  }

  function downloadText(content, filename, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    URL.revokeObjectURL(link.href);
  }

  function toast(message, type="") {
    const container = byId("toastContainer");
    if (!container) return;
    const item = el("div", `toast ${type}`, message);
    container.appendChild(item);
    setTimeout(() => item.remove(), 2800);
  }
})();

/* ── Hamburger / Mobile Nav ───────────────────────── */
(function () {
  const btn = document.getElementById("hamburgerBtn");
  const nav = document.getElementById("mobileNav");
  const overlay = document.getElementById("mobileNavOverlay");
  if (!btn || !nav || !overlay) return;

  function openMenu() {
    btn.setAttribute("aria-expanded", "true");
    nav.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeMenu() {
    btn.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  btn.addEventListener("click", () => {
    btn.getAttribute("aria-expanded") === "true" ? closeMenu() : openMenu();
  });

  overlay.addEventListener("click", closeMenu);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // Sync mobile cart badge with desktop badge
  const desktopBadge = document.getElementById("cartBadge");
  const mobileBadge  = document.getElementById("cartBadgeMobile");
  if (desktopBadge && mobileBadge) {
    const observer = new MutationObserver(() => {
      mobileBadge.textContent = desktopBadge.textContent;
    });
    observer.observe(desktopBadge, { childList: true, characterData: true, subtree: true });
  }

  // Open cart from mobile nav
  const mobileCartBtn = document.getElementById("openCartButtonMobile");
  const desktopCartBtn = document.getElementById("openCartButton");
  if (mobileCartBtn && desktopCartBtn) {
    mobileCartBtn.addEventListener("click", () => {
      closeMenu();
      setTimeout(() => desktopCartBtn.click(), 300);
    });
  }

  // Mark active page
  const links = nav.querySelectorAll(".nav-link");
  links.forEach((link) => {
    if (link.href === window.location.href) link.classList.add("active");
  });
})();

// ─── Sticky offset calculator ────────────────────────────────────────────────
// Mantiene las variables CSS --header-h y --filterbar-top actualizadas
// para que .catalog-heading-sticky y .catalog-filter-bar nunca se solapen.
(function initStickyOffsets() {
  const root = document.documentElement;

  function updateOffsets() {
    const header = document.querySelector(".site-header");
    if (!header) return;
    const headerH = header.getBoundingClientRect().height;
    root.style.setProperty("--header-h", headerH + "px");

    // Medir la altura del heading solo cuando NO está oculto
    const heading = document.querySelector(".catalog-heading-sticky");
    if (heading && !heading.classList.contains("heading-hidden")) {
      const headingH = heading.getBoundingClientRect().height;
      if (headingH > 0) root.style.setProperty("--heading-h", headingH + "px");
    }
  }

  // Ejecutar al cargar y en cada resize
  updateOffsets();
  window.addEventListener("resize", updateOffsets);

  // Usar ResizeObserver para reaccionar si el contenido del heading cambia
  const ro = new ResizeObserver(updateOffsets);
  const header = document.querySelector(".site-header");
  if (header) ro.observe(header);
})();

// ── Ocultar barra de filtros al hacer scroll hacia abajo (solo móvil) ────────
(() => {
  const wrap = document.querySelector(".catalog-sticky-wrap");
  if (!wrap) return;

  let lastY = window.scrollY;
  let ticking = false;

  function applyScrollState() {
    const currentY = window.scrollY;
    const isMobile = window.innerWidth <= 680;

    if (!isMobile) {
      // Desktop: siempre visible
      wrap.classList.remove("wrap-hidden");
    } else {
      const scrollingDown = currentY > lastY;
      const pastThreshold = currentY > 80; // no ocultar en los primeros 80px
      wrap.classList.toggle("wrap-hidden", scrollingDown && pastThreshold);
    }

    lastY = currentY;
    ticking = false;
  }

  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(applyScrollState);
      ticking = true;
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) wrap.classList.remove("wrap-hidden");
  });
})();

// ══════════════════════════════════════════════════════════════════════════════
// HERO CAROUSEL
// Lee imágenes de assets/hero/ — fallback al logo si no hay ninguna
// Para agregar imágenes: subí archivos a assets/hero/ (hero1.jpg, hero2.jpg, etc.)
// ══════════════════════════════════════════════════════════════════════════════
;(() => {
  const CAROUSEL_IMAGES = [
    // Agrega aquí las rutas de tus imágenes en assets/hero/
    // Si la carpeta no existe aún, se muestra el logo como fallback
    "assets/logo.png",
  ];

  // Intenta detectar imágenes en assets/hero/ probando nombres comunes
  const HERO_CANDIDATES = [
    "assets/hero/hero1.jpg","assets/hero/hero2.jpg","assets/hero/hero3.jpg",
    "assets/hero/hero4.jpg","assets/hero/hero5.jpg",
    "assets/hero/1.jpg","assets/hero/2.jpg","assets/hero/3.jpg",
    "assets/hero/1.png","assets/hero/2.png","assets/hero/3.png",
    "assets/hero/foto1.jpg","assets/hero/foto2.jpg","assets/hero/foto3.jpg",
  ];

  async function probeImages(candidates) {
    const results = await Promise.allSettled(
      candidates.map(src => new Promise((res, rej) => {
        const img = new Image();
        img.onload  = () => res(src);
        img.onerror = () => rej();
        img.src = src;
      }))
    );
    return results.filter(r => r.status === "fulfilled").map(r => r.value);
  }

  async function initCarousel() {
    const track = document.getElementById("carouselTrack");
    const dots  = document.getElementById("carouselDots");
    const prev  = document.getElementById("carouselPrev");
    const next  = document.getElementById("carouselNext");
    if (!track) return;

    // Detectar imágenes disponibles
    let images = await probeImages(HERO_CANDIDATES);
    if (!images.length) images = CAROUSEL_IMAGES;

    let current = 0;

    function buildSlides() {
      track.replaceChildren(...images.map((src, i) => {
        const slide = document.createElement("div");
        slide.className = "carousel-slide";
        const img = document.createElement("img");
        img.src = src;
        img.alt = `Producto ${i + 1}`;
        slide.appendChild(img);
        return slide;
      }));

      dots.replaceChildren(...images.map((_, i) => {
        const dot = document.createElement("button");
        dot.className = "carousel-dot" + (i === 0 ? " active" : "");
        dot.setAttribute("aria-label", `Imagen ${i + 1}`);
        dot.addEventListener("click", () => goTo(i));
        return dot;
      }));

      // Ocultar botones si solo hay 1 imagen
      if (images.length <= 1) {
        prev && (prev.hidden = true);
        next && (next.hidden = true);
        dots && (dots.hidden = true);
      }
    }

    function goTo(index) {
      current = (index + images.length) % images.length;
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.querySelectorAll(".carousel-dot").forEach((d, i) =>
        d.classList.toggle("active", i === current)
      );
    }

    prev?.addEventListener("click", () => goTo(current - 1));
    next?.addEventListener("click", () => goTo(current + 1));

    // Autoplay cada 4 segundos
    let timer = setInterval(() => goTo(current + 1), 4000);
    document.getElementById("heroCarousel")?.addEventListener("mouseenter", () => clearInterval(timer));
    document.getElementById("heroCarousel")?.addEventListener("mouseleave", () => {
      clearInterval(timer);
      timer = setInterval(() => goTo(current + 1), 4000);
    });

    // Swipe en touch
    let startX = 0;
    track.addEventListener("touchstart", e => { startX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener("touchend",   e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) goTo(current + (dx < 0 ? 1 : -1));
    });

    buildSlides();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCarousel);
  } else {
    initCarousel();
  }
})();

// ══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE CÓDIGOS DE CLIENTE
// ══════════════════════════════════════════════════════════════════════════════
;(() => {
  // Helper: delega al toast del IIFE principal (expuesto en window.toast)
  const toast = (msg, type) => typeof window.toast === "function" ? window.toast(msg, type) : console.log(`[${type||"info"}] ${msg}`);

  // ── Estado del código activo ──────────────────────────────────────────────
  const CLIENT_CODE_KEY = "fje_client_code";
  let activeClientCode = null; // { code, label, discount, rules: [{productId, price}] }

  function loadActiveCode() {
    try { activeClientCode = JSON.parse(localStorage.getItem(CLIENT_CODE_KEY)); } catch { activeClientCode = null; }
  }
  function saveActiveCode() {
    if (activeClientCode) localStorage.setItem(CLIENT_CODE_KEY, JSON.stringify(activeClientCode));
    else localStorage.removeItem(CLIENT_CODE_KEY);
  }

  // Exponer para que app.js principal pueda usarla al renderizar precios
  window.getClientPrice = function(product) {
    if (!activeClientCode || !product) return null;
    const rules = activeClientCode.rules || [];

    // 1. Precio fijo por producto específico (máxima prioridad)
    const productRule = rules.find(r => r.type === "product" && r.productId === product.id);
    if (productRule && productRule.price != null) return Number(productRule.price);

    // Compatibilidad con reglas antiguas sin campo type
    const legacyRule = rules.find(r => !r.type && r.productId === product.id);
    if (legacyRule && legacyRule.price != null) return Number(legacyRule.price);

    // 2. Regla por categoría (precio fijo o descuento %)
    const categoryRule = rules.find(r => r.type === "category" && r.categoryName === product.category);
    if (categoryRule) {
      if (categoryRule.price != null) return Number(categoryRule.price);
      if (categoryRule.discount > 0) return Math.round(product.price * (1 - categoryRule.discount / 100));
    }

    // 3. Descuento global %
    if (activeClientCode.discount > 0) {
      return Math.round(product.price * (1 - activeClientCode.discount / 100));
    }
    return null;
  };

  window.getActiveClientCode = () => activeClientCode;

  // ── SUPABASE: cargar/guardar códigos ─────────────────────────────────────
  async function fetchClientCodes() {
    if (!window._sb) return [];
    const { data, error } = await window._sb.from("client_codes").select("*").order("code");
    if (error) { console.error("Error cargando códigos:", error); return []; }
    return data || [];
  }

  async function upsertClientCode(codeObj) {
    const { error } = await window._sb.from("client_codes")
      .upsert({ code: codeObj.code.toUpperCase(), label: codeObj.label, discount: codeObj.discount || 0, rules: codeObj.rules || [] }, { onConflict: "code" });
    if (error) throw error;
  }

  async function deleteClientCode(code) {
    const { error } = await window._sb.from("client_codes").delete().eq("code", code);
    if (error) throw error;
  }

  async function lookupCode(rawCode) {
    if (!window._sb) return null;
    const code = rawCode.trim().toUpperCase();
    const { data } = await window._sb.from("client_codes").select("*").eq("code", code).maybeSingle();
    return data;
  }

  // ── UI TIENDA: barra de código ───────────────────────────────────────────
  function initClientCodeBar() {
    const bar    = document.getElementById("clientCodeBar");
    const input  = document.getElementById("clientCodeInput");
    const apply  = document.getElementById("clientCodeApply");
    const status = document.getElementById("clientCodeStatus");
    if (!bar) return;

    loadActiveCode();
    renderCodeStatus();

    apply?.addEventListener("click", async () => {
      const raw = input?.value?.trim();
      if (!raw) return;
      apply.textContent = "…";
      apply.disabled = true;
      const found = await lookupCode(raw);
      apply.textContent = "Aplicar";
      apply.disabled = false;
      if (!found) {
        toast("Código no válido.", "error");
        return;
      }
      activeClientCode = { code: found.code, label: found.label, discount: found.discount || 0, rules: found.rules || [] };
      saveActiveCode();
      renderCodeStatus();
      // Re-renderizar precios
      if (typeof window._rerenderPrices === "function") window._rerenderPrices();
      toast(`Código ${found.code} aplicado. ¡Precios especiales activos!`, "success");
    });

    input?.addEventListener("keydown", e => { if (e.key === "Enter") apply?.click(); });

    function renderCodeStatus() {
      if (!status) return;
      if (!activeClientCode) { status.innerHTML = ""; bar.querySelector("input") && (bar.style.display = ""); return; }
      // Ocultar el input y mostrar badge
      bar.style.display = "none";
      status.innerHTML = `
        <div class="client-code-badge">
          <span>Código: <strong>${activeClientCode.code}</strong>${activeClientCode.label ? ` · ${activeClientCode.label}` : ""}${activeClientCode.discount ? ` · ${activeClientCode.discount}% desc.` : ""}</span>
          <button id="removeCodeBtn" title="Quitar código">✕</button>
        </div>`;
      document.getElementById("removeCodeBtn")?.addEventListener("click", () => {
        activeClientCode = null;
        saveActiveCode();
        bar.style.display = "";
        if (input) input.value = "";
        renderCodeStatus();
        if (typeof window._rerenderPrices === "function") window._rerenderPrices();
        toast("Código eliminado. Viendo precios normales.", "info");
      });
    }
  }

  // ── UI ADMIN: tabla y dialog de códigos ─────────────────────────────────
  let adminCodes = [];
  let editingCode = null; // código que se está editando (string) o null para nuevo
  let draftRules  = [];   // [{productId, productName, price}]

  async function renderCodesTable() {
    const body = document.getElementById("codesTableBody");
    if (!body) return;
    adminCodes = await fetchClientCodes();
    if (!adminCodes.length) {
      body.innerHTML = `<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:20px">No hay códigos aún.</td></tr>`;
      return;
    }
    body.replaceChildren(...adminCodes.map(c => {
      const row = document.createElement("tr");
      const rulesCount = (c.rules || []).length;
      row.innerHTML = `
        <td><strong>${c.code}</strong></td>
        <td>${c.label || "—"}</td>
        <td>${c.discount > 0 ? "Descuento %" : rulesCount > 0 ? "Precios fijos" : "Sin descuento"}</td>
        <td>${c.discount > 0 ? `${c.discount}%` : "—"}</td>
        <td>${rulesCount > 0 ? `${rulesCount} regla${rulesCount > 1 ? "s" : ""}` : "—"}</td>
        <td></td>`;
      const actions = row.cells[5];
      const editBtn = document.createElement("button");
      editBtn.className = "btn-muted";
      editBtn.textContent = "Editar";
      editBtn.style.marginRight = "6px";
      editBtn.addEventListener("click", () => openCodeDialog(c));
      const delBtn = document.createElement("button");
      delBtn.className = "btn-muted";
      delBtn.textContent = "Eliminar";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar el código ${c.code}?`)) return;
        try { await deleteClientCode(c.code); await renderCodesTable(); toast("Código eliminado."); }
        catch { toast("Error al eliminar.", "error"); }
      });
      actions.append(editBtn, delBtn);
      return row;
    }));
  }

  function openCodeDialog(existing = null) {
    editingCode = existing?.code || null;
    draftRules  = existing ? JSON.parse(JSON.stringify(existing.rules || [])) : [];

    const dialog = document.getElementById("codeDialog");
    if (!dialog) return;

    document.getElementById("codeDialogTitle").textContent   = existing ? "Editar código" : "Nuevo código";
    document.getElementById("clientCodeKeyInput").value      = existing?.code || "";
    document.getElementById("clientCodeKeyInput").disabled   = !!existing;
    document.getElementById("codeLabelInput").value          = existing?.label || "";
    document.getElementById("codeDiscountInput").value       = existing?.discount || "";

    renderRulesGrid();
    dialog.showModal();
  }

  function renderRulesGrid() {
    const grid = document.getElementById("codeRulesGrid");
    if (!grid) return;
    const products   = window._adminProducts || [];
    const categories = window._state?.categories || [];

    grid.replaceChildren(...draftRules.map((rule, i) => {
      // Normalizar reglas legacy (sin type)
      if (!rule.type) rule.type = "product";

      const row = document.createElement("div");
      row.className = "code-rule-row";

      // ── Selector de tipo ──
      const typeSelect = document.createElement("select");
      typeSelect.className = "rule-type-select";
      [["product", "Producto"], ["category", "Categoría"]].forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val; opt.textContent = label;
        if (val === rule.type) opt.selected = true;
        typeSelect.appendChild(opt);
      });

      // ── Selector de producto o categoría ──
      const targetSelect = document.createElement("select");
      targetSelect.className = "rule-target-select";

      function populateTargetSelect() {
        targetSelect.replaceChildren();
        if (draftRules[i].type === "product") {
          products.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.name}${p.brand ? " · " + p.brand : ""}`;
            if (p.id === rule.productId) opt.selected = true;
            targetSelect.appendChild(opt);
          });
        } else {
          categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat; opt.textContent = cat;
            if (cat === rule.categoryName) opt.selected = true;
            targetSelect.appendChild(opt);
          });
        }
      }
      populateTargetSelect();

      typeSelect.addEventListener("change", () => {
        draftRules[i].type = typeSelect.value;
        draftRules[i].productId = undefined;
        draftRules[i].categoryName = undefined;
        draftRules[i].price = undefined;
        draftRules[i].discount = undefined;
        populateTargetSelect();
        updatePriceFields();
      });

      targetSelect.addEventListener("change", () => {
        if (draftRules[i].type === "product") draftRules[i].productId = targetSelect.value;
        else draftRules[i].categoryName = targetSelect.value;
      });

      // ── Precio fijo ──
      const priceInput = document.createElement("input");
      priceInput.type = "number"; priceInput.min = "0"; priceInput.placeholder = "Precio fijo (₡)";
      priceInput.className = "rule-price-input";
      priceInput.value = rule.price ?? "";
      priceInput.addEventListener("input", () => {
        draftRules[i].price = priceInput.value !== "" ? Number(priceInput.value) : undefined;
        if (draftRules[i].price != null) { draftRules[i].discount = undefined; discInput.value = ""; }
      });

      // ── Descuento % (solo para categoría) ──
      const discInput = document.createElement("input");
      discInput.type = "number"; discInput.min = "0"; discInput.max = "100"; discInput.placeholder = "Desc. % (categoría)";
      discInput.className = "rule-discount-input";
      discInput.value = rule.discount ?? "";
      discInput.addEventListener("input", () => {
        draftRules[i].discount = discInput.value !== "" ? Number(discInput.value) : undefined;
        if (draftRules[i].discount != null) { draftRules[i].price = undefined; priceInput.value = ""; }
      });

      function updatePriceFields() {
        const isCat = draftRules[i].type === "category";
        discInput.style.display = isCat ? "" : "none";
      }
      updatePriceFields();

      // ── Botón eliminar ──
      const del = document.createElement("button");
      del.className = "btn-muted"; del.textContent = "✕"; del.style.cssText = "padding:4px 8px;flex-shrink:0";
      del.addEventListener("click", () => { draftRules.splice(i, 1); renderRulesGrid(); });

      row.append(typeSelect, targetSelect, priceInput, discInput, del);
      return row;
    }));
  }

  function bindAdminCodeEvents() {
    document.getElementById("newCodeButton")?.addEventListener("click", () => openCodeDialog(null));

    document.getElementById("addRuleButton")?.addEventListener("click", () => {
      const products   = window._adminProducts || [];
      const categories = window._state?.categories || [];
      draftRules.push({ type: "product", productId: products[0]?.id || "", price: undefined });
      renderRulesGrid();
    });

    document.getElementById("saveCodeButton")?.addEventListener("click", async () => {
      const code     = document.getElementById("clientCodeKeyInput")?.value?.trim().toUpperCase();
      const label    = document.getElementById("codeLabelInput")?.value?.trim();
      const discount = Number(document.getElementById("codeDiscountInput")?.value || 0);
      if (!code) { toast("El código es obligatorio.", "error"); return; }
      try {
        await upsertClientCode({ code, label, discount, rules: draftRules.filter(r => r.productId) });
        document.getElementById("codeDialog")?.close();
        await renderCodesTable();
        toast("Código guardado.");
      } catch(e) {
        toast("Error al guardar: " + e.message, "error");
      }
    });
  }

  // ── Arranque ──────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "catalog") {
      initClientCodeBar();
    }
    if (page === "admin") {
      bindAdminCodeEvents();
      // Hook en showAdminPage para cargar códigos al navegar a esa pestaña
      const origShow = window._showAdminPage;
      // Escuchar clicks en el nav del admin
      document.querySelector(".admin-nav")?.addEventListener("click", async e => {
        const btn = e.target.closest("[data-admin-page]");
        if (btn?.dataset.adminPage === "codes") {
          // Exponer productos para el selector de reglas
          window._adminProducts = window._state?.products || [];
          await renderCodesTable();
        }
      });
    }
  });

  // Re-renderizar función para que app.js la llame tras aplicar código
  window._rerenderPrices = function() {
    // Busca todos los elementos de precio en el catálogo y los actualiza
    document.querySelectorAll("[data-product-id]").forEach(card => {
      const id = card.dataset.productId;
      // Trigger re-render si existe la función principal
      // (se hace recargando el renderProducts que ya aplica getClientPrice)
    });
    // La forma más limpia: si renderProducts está expuesta, llamarla
    if (typeof window._renderProducts === "function") window._renderProducts();
  };
})();
