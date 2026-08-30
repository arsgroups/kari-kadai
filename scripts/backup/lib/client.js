import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { loadEnvFile } from './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
export const BACKUPS_DIR = path.join(REPO_ROOT, 'backups')

// Signs in with the same login used on the live site (must be an Admin
// role -- the database-side functions this tool relies on all check
// is_admin() and reject anyone else). Credentials come from
// scripts/backup/.env.backup, never from anywhere committed to git.
export async function getAuthedClient() {
  const appEnv = loadEnvFile(path.join(REPO_ROOT, '.env'))
  const backupEnv = loadEnvFile(path.join(REPO_ROOT, 'scripts', 'backup', '.env.backup'))

  const url = appEnv.VITE_SUPABASE_URL
  const anonKey = appEnv.VITE_SUPABASE_ANON_KEY
  const email = backupEnv.BACKUP_EMAIL
  const password = backupEnv.BACKUP_PASSWORD

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in the project\'s .env file.')
  }
  if (!email || !password) {
    throw new Error(
      'Missing BACKUP_EMAIL / BACKUP_PASSWORD in scripts/backup/.env.backup -- copy .env.backup.example ' +
        'and fill in an Admin login.'
    )
  }

  const supabase = createClient(url, anonKey)
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`)
  }
  return supabase
}
