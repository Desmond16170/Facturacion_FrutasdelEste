
(function () {
  const SUPABASE_URL      = "https://ghbhqutmqtvlmlcqvvgl.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_i_jR2c_HsUJg3Vq3mBbNJg_45R5VBFM";

  if (typeof supabase === "undefined") {
    console.error("Supabase CDN no cargado.");
    return;
  }

  window._sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-client-info": "frutayjugosdeleste/2.0" },
    },
  });
})();
