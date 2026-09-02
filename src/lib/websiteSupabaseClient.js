import { createClient } from '@supabase/supabase-js'

// Separate Supabase project from the main Kari Kadai database (see supabaseClient.js) —
// this one holds only public-website customer logins and order/status data, so a staff
// login here is unrelated to (and does not grant) access to the main inventory project.
const websiteSupabaseUrl = import.meta.env.VITE_WEBSITE_SUPABASE_URL
const websiteSupabaseAnonKey = import.meta.env.VITE_WEBSITE_SUPABASE_ANON_KEY

// Null (not thrown) when unconfigured — Layout.jsx is on every protected route, so a
// missing/misconfigured var here must never crash the whole app, only degrade the
// Website Orders page and its sidebar badge to "not connected".
export const websiteSupabase = (websiteSupabaseUrl && websiteSupabaseAnonKey)
  ? createClient(websiteSupabaseUrl, websiteSupabaseAnonKey, {
      auth: { storageKey: 'sb-website-orders-auth' },
    })
  : (console.error(
      'Missing website Supabase env vars. Copy .env.example to .env (and set them in Vercel) with the website project URL + anon key.'
    ), null)
