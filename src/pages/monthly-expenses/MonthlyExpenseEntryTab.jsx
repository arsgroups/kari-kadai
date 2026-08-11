import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const emptyForm = { month: currentMonth(), category_id: '', description: '', amount: '', payment_method: 'Bank', remarks: '' }

export default function MonthlyExpenseEntryTab() {
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [newCategory, setNewCategory] = useState({ name: '', classification: 'fixed' })

  async function load() {
    setLoading(true)
    const [{ data: catData }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('expense_categories').select('id, name, classification').eq('is_active', true).order('name'),
      supabase
        .from('expenses')
        .select('id, date, description, amount, payment_method, remarks, expense_categories(name, classification)')
        .eq('scope', 'monthly')
        .order('date', { ascending: false })
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
      date: form.month,
      scope: 'monthly',
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
    setForm({ ...emptyForm, month: form.month })
    load()
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategory.name.trim()) return
    const { error } = await supabase
      .from('expense_categories')
      .insert({ name: newCategory.name.trim(), classification: newCategory.classification })
    if (!error) {
      setNewCategory({ name: '', classification: 'fixed' })
      load()
    }
  }

  return (
    <div>
      <div className="card">
        <h3>Log Monthly Expense</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Month
            <input
              type="month"
              value={form.month.slice(0, 7)}
              onChange={(e) => setForm({ ...form, month: `${e.target.value}-01` })}
              required
            />
          </label>
          <label>
            Category
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
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </label>
          <label>
            Payment Method
            <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option>Bank</option>
              <option>Cash</option>
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
      </div>

      <div className="card">
        <h3>Recent Entries</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Category</th>
                <th>Classification</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.date?.slice(0, 7)}</td>
                  <td>{e.expense_categories?.name}</td>
                  <td>
                    <span
                      className={e.expense_categories?.classification === 'fixed' ? 'tag tag-muted' : 'tag tag-warning'}
                    >
                      {e.expense_categories?.classification}
                    </span>
                  </td>
                  <td>{e.description}</td>
                  <td>{formatMoney(e.amount)}</td>
                  <td>{e.payment_method}</td>
                  <td>{e.remarks}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No monthly expenses logged yet.
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
