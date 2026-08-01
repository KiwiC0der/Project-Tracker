import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase is configured at build time from .env (see .env.example).
 *
 * The anon key is a publishable client key — it is designed to ship in the
 * browser bundle and is safe to commit, because every table is protected by
 * Row Level Security (see supabase/schema.sql). It is NOT the service_role
 * key, which must never reach the client.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'project-tracker-auth',
      },
    })
  : null
