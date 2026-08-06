import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'

const emptyForm = {
  date: toISODate(),
  category_id: '',
  description: '',
  amount: '',
  payment_method: 'Cash',
  remarks: '',
}

const emptyTopup = { date: toISODate(), amount: '', remarks: '' }

export default function ExpenseEntryTab() {
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [newCategory, setNewCategory] = useState({ name: '', classification: 'variable' })
  const [topup, setTopup] = useState(emptyTopup)
  const [topupSaving, setTopupSaving] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: catData }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('expense_categories').select('id, name, classification').eq('is_active', true).order('name'),
      supabase
        .from('expenses')
        .select('id, date, entry_type, description, amount, payment_method, remarks, expense_categories(name)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    setCategories(catData ?? [])
    if (entryError) setError(entryError.message)
    else setEntries(entryData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.category_id || !form.amount) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('expenses').insert({
      date: form.date,
      entry_type: 'expense',
      category_id: form.category_id,
      description: form.description || null,
      amount: Number(form.amount),
      payment_method: form.payment_method,
      remarks: form.remarks || null,
    })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm({ ...emptyForm, date: form.date })
    load()
  }

  async function handleTopup(e) {
    e.preventDefault()
    if (!topup.amount) return
    setTopupSaving(true)
    const { error } = await supabase.from('expenses').insert({
      date: topup.date,
      entry_type: 'topup',
      amount: Number(topup.amount),
      remarks: topup.remarks || null,
    })
    setTopupSaving(false)
    if (!error) {
      setTopup({ ...emptyTopup, date: topup.date })
      load()
    }
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategory.name.trim()) return
    const { error } = await supabase
      .from('expense_categories')
      .insert({ name: newCategory.name.trim(), classification: newCategory.classification })
    if (!error) {
      setNewCategory({ name: '', classification: 'variable' })
      load()
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Log Expense</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            Expense Category
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.classification})
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
            Payment Method
            <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option>Cash</option>
              <option>Bank</option>
            </select>
          </label>
          <label>
            Remarks
            <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add Expense'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}

        <details style={{ marginTop: '1rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Manage expense categories
          </summary>
          <form className="form-grid" style={{ marginTop: '0.75rem' }} onSubmit={addCategory}>
            <label>
              New Category
              <input
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                placeholder="e.g. Insurance"
              />
            </label>
            <label>
              Classification
              <select
                value={newCategory.classification}
                onChange={(e) => setNewCategory({ ...newCategory, classification: e.target.value })}
              >
                <option value="fixed">Fixed</option>
                <option value="variable">Variable</option>
              </select>
            </label>
            <button className="btn-secondary" type="submit">
              Add Category
            </button>
          </form>
        </details>

        <details style={{ marginTop: '0.75rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: '0.85rem' }}>
            Record a cash top-up (for petty cash balance tracking)
          </summary>
          <form className="form-grid" style={{ marginTop: '0.75rem' }} onSubmit={handleTopup}>
            <label>
              Date
              <input type="date" value={topup.date} onChange={(e) => setTopup({ ...topup, date: e.target.value })} />
            </label>
            <label>
              Amount (SGD)
              <input
                type="number"
                step="0.01"
                min="0"
                value={topup.amount}
                onChange={(e) => setTopup({ ...topup, amount: e.target.value })}
              />
            </label>
            <label>
              Note
              <input value={topup.remarks} onChange={(e) => setTopup({ ...topup, remarks: e.target.value })} />
            </label>
            <button className="btn-secondary" type="submit" disabled={topupSaving}>
              {topupSaving ? 'Saving…' : 'Add Top-up'}
            </button>
          </form>
        </details>
      </div>

      <div className="card">
        <h3>Recent Entries</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Remarks</th>
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
                  <td>{e.expense_categories?.name ?? '—'}</td>
                  <td>{e.description}</td>
                  <td>
                    {e.entry_type === 'topup' ? '+' : '-'}
                    {formatMoney(e.amount)}
                  </td>
                  <td>{e.payment_method ?? '—'}</td>
                  <td>{e.remarks}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No expenses logged yet.
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
