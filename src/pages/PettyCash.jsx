import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../lib/format'

const emptyForm = { date: toISODate(), entry_type: 'expense', expense_type_id: '', amount: '', note: '' }

export default function PettyCash() {
  const [entries, setEntries] = useState([])
  const [expenseTypes, setExpenseTypes] = useState([])
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [newTypeName, setNewTypeName] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: entryData, error: entryError }, { data: typeData }, { data: balanceData }] = await Promise.all([
      supabase
        .from('petty_cash_entries')
        .select('id, date, entry_type, amount, note, petty_cash_expense_types(name)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('petty_cash_expense_types').select('id, name').eq('is_active', true).order('name'),
      supabase.from('v_petty_cash_balance').select('balance').single(),
    ])
    if (entryError) setError(entryError.message)
    else setEntries(entryData ?? [])
    setExpenseTypes(typeData ?? [])
    setBalance(balanceData?.balance ?? 0)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount) return
    if (form.entry_type === 'expense' && !form.expense_type_id) {
      setError('Please select an expense type.')
      return
    }
    setSaving(true)
    setError('')
    const { error } = await supabase.from('petty_cash_entries').insert({
      date: form.date,
      entry_type: form.entry_type,
      expense_type_id: form.entry_type === 'expense' ? form.expense_type_id : null,
      amount: Number(form.amount),
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

  async function addExpenseType(e) {
    e.preventDefault()
    if (!newTypeName.trim()) return
    const { error } = await supabase.from('petty_cash_expense_types').insert({ name: newTypeName.trim() })
    if (!error) {
      setNewTypeName('')
      load()
    }
  }

  return (
    <div className="page">
      <h1>Petty Cash</h1>

      <div className="summary-tiles">
        <div className="tile">
          <div className="tile-label">Petty Cash Balance</div>
          <div className="tile-value">{formatMoney(balance)}</div>
        </div>
      </div>

      <div className="card">
        <h3>Log Entry</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            Entry Type
            <select
              value={form.entry_type}
              onChange={(e) => setForm({ ...form, entry_type: e.target.value, expense_type_id: '' })}
            >
              <option value="expense">Expense</option>
              <option value="topup">Top-up</option>
            </select>
          </label>
          {form.entry_type === 'expense' && (
            <label>
              Expense Type
              <select
                value={form.expense_type_id}
                onChange={(e) => setForm({ ...form, expense_type_id: e.target.value })}
                required
              >
                <option value="">Select…</option>
                {expenseTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add Entry'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}

        <details style={{ marginTop: '1rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Manage expense types
          </summary>
          <form className="form-grid" style={{ marginTop: '0.75rem' }} onSubmit={addExpenseType}>
            <label>
              New Expense Type
              <input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="e.g. Ice, Packaging" />
            </label>
            <button className="btn-secondary" type="submit">
              Add Type
            </button>
          </form>
        </details>
      </div>

      <div className="card">
        <h3>Entry History</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td>
                    <span className={e.entry_type === 'topup' ? 'tag tag-success' : 'tag tag-danger'}>
                      {e.entry_type === 'topup' ? 'Top-up' : 'Expense'}
                    </span>
                  </td>
                  <td>{e.petty_cash_expense_types?.name ?? '—'}</td>
                  <td>
                    {e.entry_type === 'topup' ? '+' : '-'}
                    {formatMoney(e.amount)}
                  </td>
                  <td>{e.note}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No entries yet.
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
