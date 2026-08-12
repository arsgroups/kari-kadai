import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'
import CustomerEditView from './CustomerEditView'

const emptyForm = { name: '', type: 'Restaurant', mobile: '', address: '', credit_limit: '', credit_days: '' }

export default function CustomerMasterTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showNewForm, setShowNewForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState(null)

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
    }
    const { error } = await supabase.from('customers').insert(payload)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowNewForm(false)
    setForm(emptyForm)
    load()
  }

  if (editingCustomerId) {
    return (
      <CustomerEditView
        customerId={editingCustomerId}
        onDone={() => {
          setEditingCustomerId(null)
          load()
        }}
      />
    )
  }

  return (
    <div>
      <div className="toolbar">
        <button
          className="btn"
          onClick={() => {
            setForm(emptyForm)
            setShowNewForm(true)
          }}
        >
          + Add Customer
        </button>
      </div>

      {showNewForm && (
        <div className="card">
          <h3>New Customer</h3>
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
              <textarea
                rows={3}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Unit, street, building, postal code..."
              />
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowNewForm(false)}>
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
                    <button className="btn-secondary" onClick={() => setEditingCustomerId(r.customer_id)}>
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
