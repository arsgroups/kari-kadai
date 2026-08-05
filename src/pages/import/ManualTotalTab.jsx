import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'

const emptyForm = { date: toISODate(), period_type: 'day', total_purchases_amount: '', note: '' }

export default function ManualTotalTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('manual_accounting_totals')
      .select('*')
      .order('date', { ascending: false })
      .limit(100)
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.total_purchases_amount) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('manual_accounting_totals').insert({
      date: form.date,
      period_type: form.period_type,
      total_purchases_amount: Number(form.total_purchases_amount),
      note: form.note || null,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm({ ...emptyForm, date: form.date })
    load()
  }

  return (
    <div>
      <div className="card">
        <h3>Manual Fallback Entry</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Use this when you don't have a CSV export for a period — just type in the total purchases figure
          from your accounting app so it's still captured for reconciliation, without needing line-by-line
          detail.
        </p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            Period
            <select value={form.period_type} onChange={(e) => setForm({ ...form, period_type: e.target.value })}>
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </label>
          <label>
            Total Purchases (SGD)
            <input
              type="number"
              step="0.01"
              value={form.total_purchases_amount}
              onChange={(e) => setForm({ ...form, total_purchases_amount: e.target.value })}
              required
            />
          </label>
          <label>
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>History</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Period</th>
                <th>Total Purchases</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.period_type}</td>
                  <td>{formatMoney(r.total_purchases_amount)}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No manual entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
