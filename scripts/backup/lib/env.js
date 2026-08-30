import fs from 'fs'

// Minimal KEY=VALUE parser -- avoids adding a `dotenv` dependency just for
// two small local scripts. Not meant to handle every .env edge case, just
// the plain `KEY=value` / `KEY="value"` lines this project's .env files use.
export function loadEnvFile(filePath) {
  const result = {}
  if (!fs.existsSync(filePath)) return result
  const content = fs.readFileSync(filePath, 'utf8')
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const idx = trimmed.indexOf('=')
    if (idx === -1) return
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  })
  return result
}
