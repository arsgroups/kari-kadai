import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { getAuthedClient, BACKUPS_DIR } from './lib/client.js'
import { TABLE_ORDER, STORAGE_BUCKETS } from './lib/tables.js'

function latestBackupDir() {
  if (!fs.existsSync(BACKUPS_DIR)) return null
  const dirs = fs.readdirSync(BACKUPS_DIR).filter((d) => fs.statSync(path.join(BACKUPS_DIR, d)).isDirectory())
  if (dirs.length === 0) return null
  dirs.sort()
  return path.join(BACKUPS_DIR, dirs[dirs.length - 1])
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  )
}

async function insertInBatches(supabase, table, rows) {
  const batchSize = 500
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) throw new Error(`Inserting into "${table}" failed: ${error.message}`)
  }
}

function walkFiles(dir) {
  let results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results = results.concat(walkFiles(full))
    else results.push(full)
  }
  return results
}

async function restoreStorage(supabase, sourceDir) {
  for (const bucket of STORAGE_BUCKETS) {
    const bucketDir = path.join(sourceDir, 'storage', bucket)
    if (!fs.existsSync(bucketDir)) continue
    for (const filePath of walkFiles(bucketDir)) {
      const relPath = path.relative(bucketDir, filePath).split(path.sep).join('/')
      const buffer = fs.readFileSync(filePath)
      const { error } = await supabase.storage.from(bucket).upload(relPath, buffer, { upsert: true })
      if (error) throw new Error(`Uploading "${bucket}/${relPath}" failed: ${error.message}`)
      console.log(`  storage: ${bucket}/${relPath}`)
    }
  }
}

async function main() {
  const argDir = process.argv[2]
  const sourceDir = argDir ? path.resolve(argDir) : latestBackupDir()
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    console.error('No backup folder found. Pass one explicitly: node restore.js "backups/2026-08-30_1200"')
    process.exitCode = 1
    return
  }

  const manifestPath = path.join(sourceDir, 'manifest.json')
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null

  console.log('=========================================================')
  console.log(' RESTORE WILL PERMANENTLY DELETE ALL CURRENT DATA AND')
  console.log(' REPLACE IT WITH THIS BACKUP. THIS CANNOT BE UNDONE.')
  console.log('=========================================================')
  console.log(`Backup folder: ${sourceDir}`)
  if (manifest) console.log(`Backup taken: ${manifest.createdAt}`)
  console.log('')

  const answer = await ask('Type RESTORE (all caps) to continue, anything else to cancel: ')
  if (answer.trim() !== 'RESTORE') {
    console.log('Cancelled -- nothing was changed.')
    return
  }

  console.log('\nSigning in...')
  const supabase = await getAuthedClient()

  console.log('Disabling triggers (so restoring old rows does not re-fire stock/audit/cost logic)...')
  const { error: disableErr } = await supabase.rpc('admin_set_triggers', { p_enable: false })
  if (disableErr) {
    throw new Error(`admin_set_triggers(false) failed: ${disableErr.message} (is this login an Admin?)`)
  }

  try {
    console.log('Clearing existing data...')
    for (const table of [...TABLE_ORDER].reverse()) {
      const { error } = await supabase.rpc('admin_truncate_table', { p_table: table })
      if (error) throw new Error(`Truncating "${table}" failed: ${error.message}`)
      console.log(`  truncated: ${table}`)
    }

    console.log('\nRestoring data...')
    for (const table of TABLE_ORDER) {
      const filePath = path.join(sourceDir, 'data', `${table}.json`)
      if (!fs.existsSync(filePath)) {
        console.log(`  skip: ${table} (no backup file)`)
        continue
      }
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows`)
        continue
      }
      await insertInBatches(supabase, table, rows)
      console.log(`  ${table}: ${rows.length} rows restored`)
    }
  } finally {
    console.log('\nRe-enabling triggers...')
    const { error: enableErr } = await supabase.rpc('admin_set_triggers', { p_enable: true })
    if (enableErr) {
      console.error(
        `\n!!! FAILED to re-enable triggers: ${enableErr.message}\n` +
          '!!! Run this in Supabase SQL Editor right away: select admin_set_triggers(true);'
      )
    }
  }

  console.log('\nRestoring storage files...')
  await restoreStorage(supabase, sourceDir)

  await supabase.auth.signOut()
  console.log('\nRestore complete.')
}

main().catch((err) => {
  console.error('\nRestore FAILED:', err.message)
  process.exitCode = 1
})
