// Supabase Edge Function: daily-backup
//
// Generates a SQL-format data dump + a set of Excel files covering the
// business's data, uploads them to Google Drive under
// ERP Backup/YYYY/MM/YYYY-MM-DD/, and logs the outcome to backup_logs.
//
// Invoked either:
//   - automatically by the `daily_closing_backup` Postgres trigger
//     (see migration_010_backup_infra.sql), authenticated via a shared
//     secret header, or
//   - manually from the app's Settings page (Test Connection / Run Backup
//     Now), authenticated via the logged-in user's Supabase session.
//
// Required secrets (set via `supabase secrets set …`, never committed):
//   BACKUP_TRIGGER_SECRET     — matches the 'backup_trigger_secret' Vault entry in Postgres
//   GOOGLE_OAUTH_CLIENT_ID     — from a Google Cloud OAuth client (Desktop app type)
//   GOOGLE_OAUTH_CLIENT_SECRET — from the same OAuth client
//   GOOGLE_OAUTH_REFRESH_TOKEN — obtained once via Google's OAuth Playground, authorizing
//                                your own Drive account (no service account needed —
//                                this uploads as you, into a folder you already own)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically to
// every Edge Function — no need to set those yourself.

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BACKUP_TRIGGER_SECRET = Deno.env.get('BACKUP_TRIGGER_SECRET')
const GOOGLE_OAUTH_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
const GOOGLE_OAUTH_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
const GOOGLE_OAUTH_REFRESH_TOKEN = Deno.env.get('GOOGLE_OAUTH_REFRESH_TOKEN')

const BACKUP_TABLES = [
  'products',
  'customers',
  'suppliers',
  'expense_categories',
  'customer_item_prices',
  'sale_invoices',
  'sale_invoice_items',
  'purchase_invoices',
  'purchase_invoice_items',
  'customer_payments',
  'supplier_payments',
  'expenses',
  'stock_movements',
  'stock_verifications',
  'daily_closing',
]

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const authorized = await isAuthorized(req, admin)
  if (!authorized) return json({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  const date = body.date || new Date().toISOString().slice(0, 10)
  const dryRun = body.dryRun === true

  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) {
    return json({ error: 'Google OAuth secrets are not fully set on this function' }, 500)
  }

  const { data: settings } = await admin.from('backup_settings').select('*').single()
  if (!settings?.drive_folder_id) {
    return json({ error: 'No Google Drive folder configured in Backup Settings' }, 400)
  }

  if (dryRun) {
    try {
      const accessToken = await getGoogleAccessToken()
      await findOrCreateFolder(accessToken, settings.drive_folder_id, 'connection-test')
      return json({ ok: true, message: 'Connected to Google Drive successfully.' })
    } catch (err) {
      return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500)
    }
  }

  const { data: logRow } = await admin
    .from('backup_logs')
    .insert({ date, status: 'running', attempt_count: 1 })
    .select()
    .single()

  try {
    const tableData = await fetchAllTables(admin)
    const files = buildBackupFiles(date, tableData)

    const accessToken = await getGoogleAccessToken()
    const dateFolderId = await ensureDateFolderPath(accessToken, settings.drive_folder_id, date)

    const uploaded: { name: string; link: string }[] = []
    for (const file of files) {
      const link = await uploadWithRetry(accessToken, dateFolderId, file)
      uploaded.push({ name: file.name, link })
    }

    await admin.from('backup_logs').update({ status: 'success', files: uploaded }).eq('id', logRow.id)
    return json({ ok: true, files: uploaded })
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    await admin.from('backup_logs').update({ status: 'failed', error: message }).eq('id', logRow.id)
    return json({ ok: false, error: message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function isAuthorized(req: Request, admin: ReturnType<typeof createClient>) {
  const secretHeader = req.headers.get('X-Backup-Secret')
  if (secretHeader && BACKUP_TRIGGER_SECRET && secretHeader === BACKUP_TRIGGER_SECRET) return true

  const authHeader = req.headers.get('Authorization')
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '')
    const { data } = await admin.auth.getUser(token)
    if (data?.user) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Data fetch + file generation
// ---------------------------------------------------------------------------

async function fetchAllTables(admin: ReturnType<typeof createClient>) {
  const result: Record<string, Record<string, unknown>[]> = {}
  for (const table of BACKUP_TABLES) {
    const { data, error } = await admin.from(table).select('*')
    if (error) throw new Error(`Fetching ${table}: ${error.message}`)
    result[table] = data ?? []
  }
  return result
}

function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildSqlDump(date: string, tableData: Record<string, Record<string, unknown>[]>): string {
  const lines: string[] = [
    `-- Kari Kadai data backup — ${date}`,
    `-- Generated automatically. This is a data dump (INSERT statements), not a`,
    `-- full pg_dump schema export — restore into a database that already has`,
    `-- the schema from supabase/schema.sql applied.`,
    '',
  ]
  for (const [table, rows] of Object.entries(tableData)) {
    if (rows.length === 0) continue
    lines.push(`-- ${table} (${rows.length} rows)`)
    const columns = Object.keys(rows[0])
    for (const row of rows) {
      const values = columns.map((c) => sqlEscape(row[c])).join(', ')
      lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values});`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function sheetFromRows(rows: Record<string, unknown>[]) {
  return XLSX.utils.json_to_sheet(rows)
}

function buildBackupFiles(date: string, t: Record<string, Record<string, unknown>[]>) {
  const files: { name: string; content: Uint8Array; mimeType: string }[] = []

  const sqlText = buildSqlDump(date, t)
  files.push({ name: 'database.sql', content: new TextEncoder().encode(sqlText), mimeType: 'text/plain' })

  const excelSpecs: [string, Record<string, unknown>[]][] = [
    ['sales.xlsx', t.sale_invoices],
    ['purchase.xlsx', t.purchase_invoices],
    ['expenses.xlsx', t.expenses],
    ['customers.xlsx', t.customers],
    ['suppliers.xlsx', t.suppliers],
    ['customer_prices.xlsx', t.customer_item_prices],
  ]
  for (const [name, rows] of excelSpecs) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows ?? []), 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    files.push({
      name,
      content: new Uint8Array(buf),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
  }

  return files
}

// ---------------------------------------------------------------------------
// Google Drive (OAuth refresh-token auth + folder/file management)
//
// Uploads as your own Google account (via a one-time-authorized refresh
// token), not a service account — no key file, no sharing step, and it
// isn't affected by organization policies that block service account keys.
// ---------------------------------------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null

async function getGoogleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN!,
    }),
  })
  if (!res.ok) throw new Error(`Google auth failed: ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

async function findOrCreateFolder(accessToken: string, parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`
  )
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const listData = await listRes.json()
  if (listData.files?.length > 0) return listData.files[0].id

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  if (!createRes.ok) throw new Error(`Creating Drive folder "${name}": ${await createRes.text()}`)
  const created = await createRes.json()
  return created.id
}

async function ensureDateFolderPath(accessToken: string, rootFolderId: string, date: string): Promise<string> {
  const [year, month, day] = date.split('-')
  const yearFolder = await findOrCreateFolder(accessToken, rootFolderId, year)
  const monthFolder = await findOrCreateFolder(accessToken, yearFolder, month)
  const dayFolder = await findOrCreateFolder(accessToken, monthFolder, `${year}-${month}-${day}`)
  return dayFolder
}

async function uploadFile(
  accessToken: string,
  folderId: string,
  file: { name: string; content: Uint8Array; mimeType: string }
): Promise<string> {
  const boundary = 'kari_kadai_backup_boundary'
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] })

  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    encoder.encode(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
    file.content,
    encoder.encode(`\r\n--${boundary}--`),
  ]
  const body = new Blob(parts)

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new Error(`Uploading ${file.name}: ${await res.text()}`)
  const data = await res.json()
  return data.webViewLink ?? data.id
}

async function uploadWithRetry(
  accessToken: string,
  folderId: string,
  file: { name: string; content: Uint8Array; mimeType: string },
  attempts = 3
): Promise<string> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await uploadFile(accessToken, folderId, file)
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw lastError
}
