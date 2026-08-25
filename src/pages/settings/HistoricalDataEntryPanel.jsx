import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, roundSurcharge } from '../../lib/gst'
import { toISODate } from '../../lib/format'

const HISTORICAL_SUPPLIER_NAME = 'Historical Data (Previous System)'
const HISTORICAL_NOTE = 'Historical import — previous system daily total'
const SALES_CHANNELS = [
  { key: 'counterSales', channel: 'Counter', label: 'Counter Sales' },
  { key: 'homeDeliverySales', channel: 'Home Delivery', label: 'Home Delivery Sales' },
  { key: 'restaurantSales', channel: 'Restaurant', label: 'Restaurant Sales' },
]

function emptyRow() {
  return { key: crypto.randomUUID(), date: toISODate(), counterSales: '', homeDeliverySales: '', restaurantSales: '', purchases: '', expenses: '' }
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

// Accepts ISO (2024-01-15) and day/month/year (15/01/2024 or 15-01-2024)
// directly; falls back to the JS Date parser for anything else (e.g. Excel
// re-formatting a date column as "Jan 15, 2024").
function parseCsvDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? '' : toISODate(parsed)
}

// Strips currency symbols/commas so "S$1,234.50" or "1234.5" both parse.
function cleanAmount(raw) {
  if (raw === '' || raw == null) return ''
  const cleaned = String(raw).replace(/[^0-9.-]/g, '')
  return cleaned === '' || cleaned === '-' ? '' : cleaned
}

function findColumn(row, ...aliases) {
  const keys = Object.keys(row)
  for (const alias of aliases) {
    const match = keys.find((k) => k.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === alias)
    if (match) return match
  }
  return null
}

export default function HistoricalDataEntryPanel() {
  const [rows, setRows] = useState([emptyRow()])
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [uploadWarning, setUploadWarning] = useState('')

  function updateRow(key, patch) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  function removeRow(key) {
    setRows((prev) => prev.filter((r) => r.key !== key))
  }

  function generateRange() {
    if (!rangeFrom || !rangeTo) return
    const generated = []
    let d = rangeFrom
    while (d <= rangeTo) {
      generated.push({
        key: crypto.randomUUID(),
        date: d,
        counterSales: '',
        homeDeliverySales: '',
        restaurantSales: '',
        purchases: '',
        expenses: '',
      })
      d = addDays(d, 1)
    }
    setRows(generated)
  }

  // Loads a CSV (Date, Counter Sales, Home Delivery Sales, Restaurant Sales,
  // Purchase Total, Expense Total) into the table below for review -- it
  // doesn't save anything by itself, Save All still applies the rows.
  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setSuccess('')
    setUploadWarning('')

    const XLSX = await import('xlsx')
    const text = await file.text()
    const workbook = XLSX.read(text, { type: 'string' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

    if (parsedRows.length === 0) {
      setError('No rows found in that file.')
      e.target.value = ''
      return
    }

    let skipped = 0
    const newRows = []
    parsedRows.forEach((raw) => {
      const dateCol = findColumn(raw, 'date')
      const date = parseCsvDate(dateCol ? raw[dateCol] : '')
      if (!date) {
        skipped++
        return
      }
      const counterCol = findColumn(raw, 'countersales', 'counter')
      const hdCol = findColumn(raw, 'homedeliverysales', 'homedelivery')
      const restaurantCol = findColumn(raw, 'restaurantsales', 'restaurant')
      const purchaseCol = findColumn(raw, 'purchasetotal', 'purchases', 'purchase')
      const expenseCol = findColumn(raw, 'expensetotal', 'expenses', 'expense')
      newRows.push({
        key: crypto.randomUUID(),
        date,
        counterSales: cleanAmount(counterCol ? raw[counterCol] : ''),
        homeDeliverySales: cleanAmount(hdCol ? raw[hdCol] : ''),
        restaurantSales: cleanAmount(restaurantCol ? raw[restaurantCol] : ''),
        purchases: cleanAmount(purchaseCol ? raw[purchaseCol] : ''),
        expenses: cleanAmount(expenseCol ? raw[expenseCol] : ''),
      })
    })

    if (newRows.length === 0) {
      setError('Could not find any valid dated rows in that file — check the Date column.')
      e.target.value = ''
      return
    }

    setRows(newRows)
    setUploadWarning(
      skipped > 0 ? `Loaded ${newRows.length} row(s) for review — ${skipped} row(s) skipped (no valid date).` : `Loaded ${newRows.length} row(s) for review below. Check the numbers, then click Save All.`
    )
    e.target.value = ''
  }

  async function getOrCreateHistoricalSupplierId() {
    const { data: existing } = await supabase
      .from('suppliers')
      .select('id')
      .eq('name', HISTORICAL_SUPPLIER_NAME)
      .maybeSingle()
    if (existing) return existing.id
    const { data: created, error: createError } = await supabase
      .from('suppliers')
      .insert({ name: HISTORICAL_SUPPLIER_NAME, gst_registered: false })
      .select()
      .single()
    if (createError) throw new Error(createError.message)
    return created.id
  }

  async function handleSaveAll() {
    setError('')
    setSuccess('')

    const validRows = rows.filter(
      (r) =>
        r.date &&
        (SALES_CHANNELS.some((c) => Number(r[c.key]) > 0) || Number(r.purchases) > 0 || Number(r.expenses) > 0)
    )
    if (validRows.length === 0) {
      setError('Enter at least one amount on at least one dated row.')
      return
    }

    setSaving(true)

    let supplierId = null
    if (validRows.some((r) => Number(r.purchases) > 0)) {
      try {
        supplierId = await getOrCreateHistoricalSupplierId()
      } catch (e) {
        setSaving(false)
        setError(e.message)
        return
      }
    }

    // Restaurant's 9% surcharge is derived the same way it is at Sale entry
    // and on Sales Returns -- extracted from the entered (inclusive) amount,
    // rounded to the nearest 50 cents (10 cents if under $1).
    const rateHistory = await fetchRateHistory()
    const getRate = buildRateResolver(rateHistory)

    let salesCount = 0
    let purchaseCount = 0
    let expenseCount = 0

    for (const row of validRows) {
      for (const { key, channel, label } of SALES_CHANNELS) {
        const amount = Number(row[key])
        if (amount <= 0) continue
        // The entered Restaurant amount is already the final figure with its
        // 9% surcharge baked in -- extract it out rather than adding more on
        // top, so subtotal + gst_amount reconstructs exactly to `amount`.
        const gstAmount =
          channel === 'Restaurant' ? roundSurcharge(amount - amount / (1 + getRate(row.date) / 100)) : 0
        const subtotal = amount - gstAmount
        const { error: err } = await supabase.from('sale_invoices').insert({
          date: row.date,
          channel,
          payment_type: 'Cash',
          subtotal,
          gst_amount: gstAmount,
          paid_amount: amount,
          remarks: HISTORICAL_NOTE,
        })
        if (err) {
          setSaving(false)
          setError(`Failed on ${row.date} (${label}): ${err.message}`)
          return
        }
        salesCount++
      }
      if (Number(row.purchases) > 0) {
        const { error: err } = await supabase.from('purchase_invoices').insert({
          date: row.date,
          supplier_id: supplierId,
          payment_type: 'Cash',
          subtotal: Number(row.purchases),
          gst_amount: 0,
          source: 'manual',
          note: HISTORICAL_NOTE,
        })
        if (err) {
          setSaving(false)
          setError(`Failed on ${row.date} (purchases): ${err.message}`)
          return
        }
        purchaseCount++
      }
      if (Number(row.expenses) > 0) {
        const { error: err } = await supabase.from('expenses').insert({
          date: row.date,
          scope: 'daily',
          entry_type: 'expense',
          category_id: null,
          description: HISTORICAL_NOTE,
          amount: Number(row.expenses),
          payment_method: 'Cash',
        })
        if (err) {
          setSaving(false)
          setError(`Failed on ${row.date} (expenses): ${err.message}`)
          return
        }
        expenseCount++
      }
    }

    setSaving(false)
    setSuccess(
      `Imported ${validRows.length} day(s): ${salesCount} sales entr(y/ies), ${purchaseCount} purchase total(s), ${expenseCount} expense total(s).`
    )
    setRows([emptyRow()])
  }

  return (
    <div className="card">
      <h3>Historical Data Entry</h3>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        For days run on your previous system before switching to this app. Enter one row per day with
        that day's <strong>totals</strong> (not itemized) — sales broken down by channel (Counter, Home
        Delivery, Restaurant), plus purchases and expenses. Each non-empty amount becomes a single
        invoice/expense entry for that date and channel, feeding Dashboard, P&amp;L, and Monthly Revenue
        correctly. For Restaurant, enter the final figure you actually collected (already including its
        9% surcharge) — it's split back into subtotal + surcharge for reporting, nothing extra is added
        on top. This does{' '}
        <strong>not</strong> affect current stock levels or item-level reports (no line items are
        created, so no stock movements happen). If all of a day's sales were from one channel, just fill
        in that channel's box and leave the others blank. Purchases are recorded under an auto-created
        supplier named "{HISTORICAL_SUPPLIER_NAME}".
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <strong>Upload CSV</strong>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0.6rem' }}>
          Columns: <code>Date, Counter Sales, Home Delivery Sales, Restaurant Sales, Purchase Total, Expense
          Total</code> (column order doesn't matter, blank cells are fine). This loads the rows into the
          table below for you to check — nothing is saved until you click Save All.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} />
        {uploadWarning && <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{uploadWarning}</p>}
      </div>

      <div className="form-grid" style={{ marginBottom: '1rem', maxWidth: 500 }}>
        <label>
          Generate rows: From
          <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        </label>
        <button type="button" className="btn-secondary" onClick={generateRange} disabled={!rangeFrom || !rangeTo}>
          Generate Date Rows
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Counter Sales</th>
            <th>Home Delivery Sales</th>
            <th>Restaurant Sales</th>
            <th>Purchase Total</th>
            <th>Expense Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} />
              </td>
              {SALES_CHANNELS.map(({ key }) => (
                <td key={key}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    style={{ width: 100 }}
                    value={row[key]}
                    onChange={(e) => updateRow(row.key, { [key]: e.target.value })}
                  />
                </td>
              ))}
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 110 }}
                  value={row.purchases}
                  onChange={(e) => updateRow(row.key, { purchases: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 110 }}
                  value={row.expenses}
                  onChange={(e) => updateRow(row.key, { expenses: e.target.value })}
                />
              </td>
              <td>
                <button type="button" className="btn-secondary" onClick={() => removeRow(row.key)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="toolbar" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="btn-secondary" onClick={addRow}>
          + Add Row
        </button>
        <button type="button" className="btn" disabled={saving} onClick={handleSaveAll}>
          {saving ? 'Saving…' : 'Save All'}
        </button>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
    </div>
  )
}
