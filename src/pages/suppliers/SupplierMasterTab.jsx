import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'
import { useAuth } from '../../contexts/AuthContext'

const emptyForm = { id: null, name: '', phone: '', address: '', gst_registered: true, credit_days: '', is_active: true }

export default function SupplierMasterTab() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('v_supplier_outstanding').select('*').order('name')
    if (error) setError(error.message)
    else setRows(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function startEdit(row) {
    const { data } = await supabase.from('suppliers').select('*').eq('id', row.supplier_id).single()
    if (data) {
      setForm({
        id: data.id,
        name: data.name,
        phone: data.phone ?? data.contact ?? '',
        address: data.address ?? '',
        gst_registered: data.gst_registered,
        credit_days: data.credit_days ?? '',
        is_active: data.is_active,
      })
      setShowForm(true)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      phone: form.phone || null,
      contact: form.phone || null, // kept in sync for backward compatibility
      address: form.address || null,
      gst_registered: form.gst_registered,
      credit_days: form.credit_days === '' ? null : Number(form.credit_days),
      is_active: form.id ? form.is_active : true,
    }
    const { error } = form.id
      ? await supabase.from('suppliers').update(payload).eq('id', form.id)
      : await supabase.from('suppliers').insert(payload)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  async function handleDelete() {
    if (!form.id) return
    if (!window.confirm(`Delete supplier "${form.name}"? This cannot be undone.`)) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('suppliers').delete().eq('id', form.id)
    setSaving(false)
    if (error) {
      setError(
        error.code === '23503'
          ? 'This supplier can’t be deleted because it has existing purchase invoices or payments linked to it. Mark it inactive instead.'
          : error.message
      )
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
          + Add Supplier
        </button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{form.id ? 'Edit Supplier' : 'New Supplier'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label>
              Address
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
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
            <label>
              <span style={{ display: 'block', marginBottom: '0.3rem' }}>GST Registered?</span>
              <select
                value={form.gst_registered ? 'yes' : 'no'}
                onChange={(e) => setForm({ ...form, gst_registered: e.target.value === 'yes' })}
              >
                <option value="yes">Yes — charges GST</option>
                <option value="no">No — doesn't charge GST</option>
              </select>
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
              {form.id && isAdmin && (
                <button type="button" className="btn-danger" disabled={saving} onClick={handleDelete}>
                  Delete
                </button>
              )}
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
                <th>We Owe (Outstanding)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.supplier_id}>
                  <td>{r.name}</td>
                  <td>{formatMoney(r.outstanding)}</td>
                  <td>
                    <button className="btn-secondary" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    No suppliers yet.
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
