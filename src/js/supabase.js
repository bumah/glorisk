/**
 * GloRisk — Supabase Client
 * Shared authentication and database client.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://yxtyotpvtgocavnopbdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dHlvdHB2dGdvY2F2bm9wYmR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODUwNzAsImV4cCI6MjA5MDU2MTA3MH0.pioNKXByT_MmFMo6pVAtS1DvJkwBW-EAQhN3p3AL524';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Get current user
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Sign up with email
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { data, error };
}

// Sign in with email
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// Reset password
export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/watchlist.html',
  });
  return { data, error };
}

// Listen for auth changes
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user ?? null, event);
  });
}

// ── Watchlist operations ────────────────────────────────────────────────

export async function getWatchlist() {
  const user = await getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') console.error('getWatchlist:', error);
  return data;
}

export async function saveWatchlistCloud(tickers) {
  const user = await getUser();
  if (!user) return null;

  // Try to update existing watchlist
  const existing = await getWatchlist();
  if (existing) {
    const { data, error } = await supabase
      .from('watchlists')
      .update({ tickers, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) console.error('saveWatchlist update:', error);
    return data;
  }

  // Create new watchlist
  const { data, error } = await supabase
    .from('watchlists')
    .insert({ user_id: user.id, tickers })
    .select()
    .single();
  if (error) console.error('saveWatchlist insert:', error);
  return data;
}
