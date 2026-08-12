import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'
import { useAuth } from '../../contexts/AuthContext'

const emptyForm = {
  date: toISODate(),
  category_id: '',
  description: '',
  amount: '',
  payment_method: 'Cash',
  remarks: '',
}

const emptyTopup = { date: toISODate(), amount: '', remarks: '' }

export default function DailyExpenseEntryTab() {
  const { isAdmin } = useAuth()
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [newCategory, setNewCategory] = useState({ name: '', classification: 'variable' })
  const [topup, setTopup] = useState(emptyTopup)
  const [topupSaving, setTopupSaving] = useState(false)
  const [editingTopupId, setEditingTopupId] = useState(null)
  const [topupSectionOpen, setTopupSectionOpen] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  async function load() {
    setLoading(true)
    const [{ data: catData }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('expense_categories').select('id, name, classification').eq('is_active', true).order('name'),
      supabase
        .from('expenses')
        .select('id, date, entry_type, category_id, description, amount, payment_method, remarks, expense_categories(name)')
        .eq('scope', 'daily')
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
    const payload = {
      date: form.date,
      scope: 'daily',
      entry_type: 'expense',
      category_id: form.category_id,
      description: form.description || null,
      amount: Number(form.amount),
      payment_method: form.payment_method,
      remarks: form.remarks || null,
    }
    const { error } = editingId
      ? await supabase.from('expenses').update(payload).eq('id', editingId)
      : await supabase.from('expenses').insert(payload)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setForm({ ...emptyForm, date: form.date })
    setEditingId(null)
    load()
  }

  function startEditExpense(entry) {
    setForm({
      date: entry.date,
      category_id: entry.category_id ?? '',
      description: entry.description ?? '',
      amount: String(entry.amount),
      payment_method: entry.payment_method ?? 'Cash',
      remarks: entry.remarks ?? '',
    })
    setEditingId(entry.id)
    setError('')
  }

  function cancelEditExpense() {
    setForm({ ...emptyForm, date: form.date })
    setEditingId(null)
  }

  async function handleTopup(e) {
    e.preventDefault()
    if (!topup.amount) return
    setTopupSaving(true)
    const payload = {
      date: topup.date,
      scope: 'daily',
      entry_type: 'topup',
      amount: Number(topup.amount),
      remarks: topup.remarks || null,
    }
    const { error } = editingTopupId
      ? await supabase.from('expenses').update(payload).eq('id', editingTopupId)
      : await supabase.from('expenses').insert(payload)
    setTopupSaving(false)
    if (!error) {
      setTopup({ ...emptyTopup, date: topup.date })
      setEditingTopupId(null)
      load()
    }
  }

  function startEditTopup(entry) {
    setTopup({ date: entry.date, amount: String(entry.amount), remarks: entry.remarks ?? '' })
    setEditingTopupId(entry.id)
    setTopupSectionOpen(true)
  }

  function cancelEditTopup() {
    setTopup({ ...emptyTopup, date: topup.date })
    setEditingTopupId(null)
  }

  async function handleDelete(entry) {
    if (!window.confirm(`Delete this ${entry.entry_type === 'topup' ? 'top-up' : 'expense'} entry? This cannot be undone.`))
      return
    setDeletingId(entry.id)
    const { error } = await supabase.from('expenses').delete().eq('id', entry.id)
    setDeletingId(null)
    if (error) {
      setError(error.message)
      return
    }
    load()
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
        <h3>Log Daily Expense</h3>
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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update Expense' : 'Add Expense'}
            </button>
            {editingId && (
              <button type="button" className="btn-secondary" onClick={cancelEditExpense}>
                Cancel
              </button>
            )}
          </div>
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

        <details
          style={{ marginTop: '0.75rem' }}
          open={topupSectionOpen}
          onToggle={(e) => setTopupSectionOpen(e.target.open)}
        >
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-secondary" type="submit" disabled={topupSaving}>
                {topupSaving ? 'Saving…' : editingTopupId ? 'Update Top-up' : 'Add Top-up'}
              </button>
              {editingTopupId && (
                <button type="button" className="btn-secondary" onClick={cancelEditTopup}>
                  Cancel
                </button>
              )}
            </div>
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
                <th></th>
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
                  <td>{e.payment_method}</td>
                  <td>{e.remarks}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => (e.entry_type === 'topup' ? startEditTopup(e) : startEditExpense(e))}
                    >
                      Edit
                    </button>{' '}
                    {isAdmin && (
                      <button className="btn-danger" disabled={deletingId === e.id} onClick={() => handleDelete(e)}>
                        {deletingId === e.id ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
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
