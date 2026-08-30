import fs from 'fs'
import path from 'path'
import { getAuthedClient, BACKUPS_DIR } from './lib/client.js'
import { TABLE_ORDER, STORAGE_BUCKETS } from './lib/tables.js'

function timestamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function fetchAllRows(supabase, table) {
  const pageSize = 1000
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1)
    if (error) throw new Error(`Reading "${table}" failed: ${error.message}`)
    all = all.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return all
}

async function listAllFiles(supabase, bucket, prefix = '') {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`Listing storage "${bucket}/${prefix}" failed: ${error.message}`)
  let files = []
  for (const item of data ?? []) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name
    if (item.id === null) {
      files = files.concat(await listAllFiles(supabase, bucket, itemPath))
    } else {
      files.push(itemPath)
    }
  }
  return files
}

async function backupStorage(supabase, targetDir) {
  const storageManifest = {}
  for (const bucket of STORAGE_BUCKETS) {
    const files = await listAllFiles(supabase, bucket)
    storageManifest[bucket] = files
    for (const filePath of files) {
      const { data, error } = await supabase.storage.from(bucket).download(filePath)
      if (error) throw new Error(`Downloading "${bucket}/${filePath}" failed: ${error.message}`)
      const buffer = Buffer.from(await data.arrayBuffer())
      const destPath = path.join(targetDir, 'storage', bucket, filePath)
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.writeFileSync(destPath, buffer)
      console.log(`  storage: ${bucket}/${filePath} (${buffer.length} bytes)`)
    }
  }
  return storageManifest
}

async function main() {
  console.log('Signing in...')
  const supabase = await getAuthedClient()

  const stamp = timestamp()
  const targetDir = path.join(BACKUPS_DIR, stamp)
  fs.mkdirSync(path.join(targetDir, 'data'), { recursive: true })

  console.log(`Backing up into: ${targetDir}\n`)

  const rowCounts = {}
  for (const table of TABLE_ORDER) {
    const rows = await fetchAllRows(supabase, table)
    fs.writeFileSync(path.join(targetDir, 'data', `${table}.json`), JSON.stringify(rows, null, 2))
    rowCounts[table] = rows.length
    console.log(`  table: ${table} (${rows.length} rows)`)
  }

  console.log('\nDownloading storage files...')
  const storageManifest = await backupStorage(supabase, targetDir)

  const manifest = {
    createdAt: new Date().toISOString(),
    rowCounts,
    storageManifest,
  }
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  await supabase.auth.signOut()

  console.log(`\nBackup complete: ${targetDir}`)
  console.log('Keep this folder somewhere safe (e.g. copy it to a USB drive or cloud storage).')
}

main().catch((err) => {
  console.error('\nBackup FAILED:', err.message)
  process.exitCode = 1
})
