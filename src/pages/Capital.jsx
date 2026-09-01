import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../lib/format'
import { round2 } from '../lib/gst'
import { useAuth } from '../contexts/AuthContext'

const emptyForm = {
  date: toISODate(),
  partner_name: '',
  transaction_type: 'contribution',
  amount: '',
  description: '',
  reference: '',
}

// Partner contributions and withdrawals -- kept entirely separate from
// operating income/expense, and from the Month-End Report's P&L (Reports ->
// Month-End Report reads this table for its Capital section, but nothing
// here ever flows into Revenue/COGS/Expenses).
export default function Capital() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('capital_transactions').select('*').order('date', { ascending: false })
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.partner_name.trim() || !form.amount) return
    setSaving(true)
    setError('')
    const payload = {
      date: form.date,
      partner_name: form.partner_name.trim(),
      transaction_type: form.transaction_type,
      amount: Number(form.amount),
      description: form.description || null,
      reference: form.reference || null,
    }
    const { error } = editingId
      ? await supabase.from('capital_transactions').update(payload).eq('id', editingId)
      : await supabase.from('capital_transactions').insert(payload)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm(emptyForm)
    setEditingId(null)
    load()
  }

  function startEdit(row) {
    setForm({
      date: row.date,
      partner_name: row.partner_name,
      transaction_type: row.transaction_type,
      amount: String(row.amount),
      description: row.description ?? '',
      reference: row.reference ?? '',
    })
    setEditingId(row.id)
    setError('')
  }

  function cancelEdit() {
    setForm(emptyForm)
    setEditingId(null)
  }

  async function handleDelete(row) {
    if (!window.confirm('Delete this capital transaction? This cannot be undone.')) return
    setDeletingId(row.id)
    const { error } = await supabase.from('capital_transactions').delete().eq('id', row.id)
    setDeletingId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
  }

  const totalContributions = round2(rows.filter((r) => r.transaction_type === 'contribution').reduce((s, r) => s + r.amount, 0))
  const totalWithdrawals = round2(rows.filter((r) => r.transaction_type === 'withdrawal').reduce((s, r) => s + r.amount, 0))
  const netCapital = round2(totalContributions - totalWithdrawals)

  return (
    <div className="page">
      <h1>Capital</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Partner contributions and withdrawals only -- kept separate from operating income and expenses. Feeds
        the Capital section of Reports → Month-End Report.
      </p>

      <div className="summary-tiles">
        <div className="tile">
          <div className="tile-label">Total Contributions</div>
          <div className="tile-value">{formatMoney(totalContributions)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Total Withdrawals</div>
          <div className="tile-value">{formatMoney(totalWithdrawals)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Net Capital (all-time)</div>
          <div className="tile-value">{formatMoney(netCapital)}</div>
        </div>
      </div>

      <div className="card">
        <h3>{editingId ? 'Edit Capital Transaction' : 'Log Capital Transaction'}</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            Partner / Investor
            <input
              value={form.partner_name}
              onChange={(e) => setForm({ ...form, partner_name: e.target.value })}
              placeholder="e.g. Ali"
              required
            />
          </label>
          <label>
            Transaction Type
            <select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
              <option value="contribution">Contribution</option>
              <option value="withdrawal">Withdrawal / Drawings</option>
            </select>
          </label>
          <label>
            Amount (SGD)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </label>
          <label>
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label>
            Reference / Remarks
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update' : 'Add Transaction'}
            </button>
            {editingId && (
              <button type="button" className="btn-secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>Capital Transactions</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Partner / Investor</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Reference</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.partner_name}</td>
                  <td>
                    <span className={r.transaction_type === 'contribution' ? 'tag tag-success' : 'tag tag-warning'}>
                      {r.transaction_type === 'contribution' ? 'Contribution' : 'Withdrawal'}
                    </span>
                  </td>
                  <td>{formatMoney(r.amount)}</td>
                  <td>{r.description}</td>
                  <td>{r.reference}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => startEdit(r)}>
                      Edit
                    </button>{' '}
                    {isAdmin && (
                      <button className="btn-danger" disabled={deletingId === r.id} onClick={() => handleDelete(r)}>
                        {deletingId === r.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No capital transactions logged yet.
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
