export function formatMoney(value) {
  const n = Number(value ?? 0)
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(value) {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value + 'T00:00:00') : value
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

// Converts a JS Date (or none = today) to yyyy-mm-dd for <input type="date"> and Postgres date columns.
export function toISODate(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const yyyy = date.getFullYear()
  return `${yyyy}-${mm}-${dd}`
}

// Shifts a yyyy-mm-dd string by `days` (negative to go back) and returns the result in the same format.
export function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toISODate(d)
}
