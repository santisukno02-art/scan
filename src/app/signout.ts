'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
export async function signOut(){const sb=await createClient();await sb.auth.signOut();redirect('/login');}
