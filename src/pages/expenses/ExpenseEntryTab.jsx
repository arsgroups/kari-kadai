import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const emptyForm = { month: currentMonth(), category_id: '', amount: '', note: '' }

export default function ExpenseEntryTab() {
  const [categories, setCategories] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [newCategory, setNewCategory] = useState({ name: '', classification: 'variable' })

  async function load() {
    setLoading(true)
    const [{ data: catData }, { data: entryData, error: entryError }] = await Promise.all([
      supabase.from('expense_categories').select('id, name, classification').eq('is_active', true).order('name'),
      supabase
        .from('monthly_expenses')
        .select('id, month, amount, note, expense_categories(name, classification)')
        .order('month', { ascending: false })
        .limit(100),
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
    const { error } = await supabase.from('monthly_expenses').insert({
      month: form.month,
      category_id: form.category_id,
      amount: Number(form.amount),
      note: form.note || null,
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
      setNewCategory({ name: '', classification: 'variable' })
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
            <input type="month" value={form.month.slice(0, 7)} onChange={(e) => setForm({ ...form, month: `${e.target.value}-01` })} required />
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
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
                placeholder="e.g. Utilities"
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
                <th>Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.month?.slice(0, 7)}</td>
                  <td>{e.expense_categories?.name}</td>
                  <td>
                    <span className={e.expense_categories?.classification === 'fixed' ? 'tag tag-muted' : 'tag tag-warning'}>
                      {e.expense_categories?.classification}
                    </span>
                  </td>
                  <td>{formatMoney(e.amount)}</td>
                  <td>{e.note}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
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
