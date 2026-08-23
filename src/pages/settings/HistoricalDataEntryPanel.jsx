import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver } from '../../lib/gst'
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

export default function HistoricalDataEntryPanel() {
  const [rows, setRows] = useState([emptyRow()])
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
    // and on Sales Returns -- computed on the entered (net) amount, rounded
    // to a whole number.
    const rateHistory = await fetchRateHistory()
    const getRate = buildRateResolver(rateHistory)

    let salesCount = 0
    let purchaseCount = 0
    let expenseCount = 0

    for (const row of validRows) {
      for (const { key, channel, label } of SALES_CHANNELS) {
        const amount = Number(row[key])
        if (amount <= 0) continue
        const gstAmount = channel === 'Restaurant' ? Math.round(amount * (getRate(row.date) / 100)) : 0
        const { error: err } = await supabase.from('sale_invoices').insert({
          date: row.date,
          channel,
          payment_type: 'Cash',
          subtotal: amount,
          gst_amount: gstAmount,
          paid_amount: amount + gstAmount,
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
        correctly (Restaurant sales get the usual 9% surcharge added, same as a live sale). This does{' '}
        <strong>not</strong> affect current stock levels or item-level reports (no line items are
        created, so no stock movements happen). If all of a day's sales were from one channel, just fill
        in that channel's box and leave the others blank. Purchases are recorded under an auto-created
        supplier named "{HISTORICAL_SUPPLIER_NAME}".
      </p>

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
