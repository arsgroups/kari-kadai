import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate } from '../../lib/format'

const emptyForm = { effective_from: '', rate_percent: '', note: '' }

// Same date-effective pattern as GST Rate Settings -- a rate change only
// affects months from its effective_from date onward. Used by Reports ->
// Month-End Report's Managing Partner Fee calculation.
export default function PartnerFeeSettingsPanel() {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('partner_fee_rate_history')
      .select('*')
      .order('effective_from', { ascending: false })
    if (error) setError(error.message)
    else setRates(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.effective_from || form.rate_percent === '') return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('partner_fee_rate_history').insert({
      effective_from: form.effective_from,
      rate_percent: Number(form.rate_percent),
      note: form.note || null,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm(emptyForm)
    load()
  }

  return (
    <div className="card">
      <h3>Managing Partner Fee</h3>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Default is 10%. Only add a new row here if the agreed rate changes in future — Reports → Month-End
        Report automatically uses whichever rate was in effect at the start of each reported month.
      </p>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Effective From
          <input
            type="date"
            value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            required
          />
        </label>
        <label>
          Rate (%)
          <input
            type="number"
            step="0.1"
            value={form.rate_percent}
            onChange={(e) => setForm({ ...form, rate_percent: e.target.value })}
            required
          />
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Add'}
        </button>
      </form>
      {error && <div className="inline-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="data-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Effective From</th>
              <th>Rate</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{formatDate(r.effective_from)}</td>
                <td>{r.rate_percent}%</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
