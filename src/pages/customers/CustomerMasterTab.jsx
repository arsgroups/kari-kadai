import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

const emptyForm = { id: null, name: '', type: 'Restaurant', contact: '', credit_limit: '', is_active: true }

export default function CustomerMasterTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('v_customer_outstanding')
      .select('*')
      .order('name')
    if (error) setError(error.message)
    else setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function startEdit(row) {
    setForm({
      id: row.customer_id,
      name: row.name,
      type: row.type,
      contact: row.contact ?? '',
      credit_limit: row.credit_limit ?? '',
      is_active: true,
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      type: form.type,
      contact: form.contact || null,
      credit_limit: form.credit_limit === '' ? null : Number(form.credit_limit),
    }
    const { error } = form.id
      ? await supabase.from('customers').update(payload).eq('id', form.id)
      : await supabase.from('customers').insert(payload)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  return (
    <div>
      <div className="toolbar">
        <button
          className="btn"
          onClick={() => {
            setForm(emptyForm)
            setShowForm(true)
          }}
        >
          + Add Customer
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{form.id ? 'Edit Customer' : 'New Customer'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option>Restaurant</option>
                <option>Home Delivery</option>
              </select>
            </label>
            <label>
              Contact
              <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </label>
            <label>
              Credit Limit (SGD, optional)
              <input
                type="number"
                step="0.01"
                value={form.credit_limit}
                onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
          {error && <div className="inline-error">{error}</div>}
        </div>
      )}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Credit Limit</th>
                <th>Outstanding</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.customer_id}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.credit_limit != null ? formatMoney(r.credit_limit) : '—'}</td>
                  <td>
                    {formatMoney(r.outstanding)}
                    {r.credit_limit != null && r.outstanding > r.credit_limit && (
                      <span className="tag tag-danger" style={{ marginLeft: '0.4rem' }}>
                        Over limit
                      </span>
                    )}
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No customers yet.
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
