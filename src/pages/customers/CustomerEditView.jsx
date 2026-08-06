import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Tabs from '../../components/Tabs'
import CustomerPriceListPanel from './CustomerPriceListPanel'

export default function CustomerEditView({ customerId, onDone }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single()
      .then(({ data }) => {
        if (data) {
          setForm({
            name: data.name,
            type: data.type,
            mobile: data.contact ?? '',
            address: data.address ?? '',
            credit_limit: data.credit_limit ?? '',
            credit_days: data.credit_days ?? '',
            is_active: data.is_active,
          })
        }
      })
  }, [customerId])

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
    const { error } = await supabase.from('customers').update(payload).eq('id', customerId)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onDone()
  }

  if (!form) return <p className="muted">Loading…</p>

  return (
    <div>
      <div className="toolbar">
        <button className="btn-secondary" onClick={onDone}>
          ← Back to Customers
        </button>
      </div>
      <Tabs
        tabs={[
          {
            key: 'details',
            label: 'Details',
            content: (
              <div className="card">
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
                  <button className="btn" type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </form>
                {error && <div className="inline-error">{error}</div>}
              </div>
            ),
          },
          {
            key: 'pricing',
            label: 'Customer Price List',
            content: <CustomerPriceListPanel customerId={customerId} />,
          },
        ]}
      />
    </div>
  )
}
