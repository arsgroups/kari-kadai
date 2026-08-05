import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatDate, formatMoney, toISODate } from '../../lib/format'

const emptyForm = { date: toISODate(), supplier_id: '', amount: '', payment_type: 'Cash', note: '' }

export default function SupplierPaymentsTab() {
  const [suppliers, setSuppliers] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)

  async function load() {
    setLoading(true)
    const [{ data: supData }, { data: payData, error: payError }] = await Promise.all([
      supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('supplier_payments')
        .select('id, date, amount, payment_type, note, suppliers(name)')
        .order('date', { ascending: false })
        .limit(200),
    ])
    setSuppliers(supData ?? [])
    if (payError) setError(payError.message)
    else setPayments(payData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.supplier_id || !form.amount) return
    setSaving(true)
    setError('')
    const { error } = await supabase.from('supplier_payments').insert({
      date: form.date,
      supplier_id: form.supplier_id,
      amount: Number(form.amount),
      payment_type: form.payment_type,
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

  return (
    <div>
      <div className="card">
        <h3>Record Payment to Supplier</h3>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            Supplier
            <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required>
              <option value="">Select…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
            Payment Type
            <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
              <option>Cash</option>
              <option>Bank</option>
            </select>
          </label>
          <label>
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </form>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Amount</th>
                <th>Type</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{p.suppliers?.name}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.payment_type}</td>
                  <td>{p.note}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No payments recorded yet.
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
