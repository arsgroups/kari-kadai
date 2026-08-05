import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'

const emptyForm = {
  id: null,
  name: '',
  type: 'Restaurant',
  mobile: '',
  address: '',
  credit_limit: '',
  credit_days: '',
  is_active: true,
}

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

  async function startEdit(row) {
    const { data } = await supabase.from('customers').select('*').eq('id', row.customer_id).single()
    if (!data) return
    setForm({
      id: data.id,
      name: data.name,
      type: data.type,
      mobile: data.contact ?? '',
      address: data.address ?? '',
      credit_limit: data.credit_limit ?? '',
      credit_days: data.credit_days ?? '',
      is_active: data.is_active,
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
      contact: form.mobile || null,
      address: form.address || null,
      credit_limit: form.credit_limit === '' ? null : Number(form.credit_limit),
      credit_days: form.credit_days === '' ? null : Number(form.credit_days),
      is_active: form.is_active,
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
              Mobile
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </label>
            <label>
              Address
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
            <label>
              Credit Days
              <input
                type="number"
                step="1"
                value={form.credit_days}
                onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
              />
            </label>
            {form.id && (
              <label>
                <span style={{ display: 'block', marginBottom: '0.3rem' }}>Status</span>
                <select
                  value={form.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setForm({ ...form, is_active: e.target.value === 'active' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            )}
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
