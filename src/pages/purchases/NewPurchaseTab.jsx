import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, round2 } from '../../lib/gst'
import { toISODate, formatMoney } from '../../lib/format'

const emptyForm = {
  date: toISODate(),
  supplier_id: '',
  amount_before_gst: '',
  gst_applicable: true,
  payment_type: 'Cash',
  note: '',
}

export default function NewPurchaseTab() {
  const [suppliers, setSuppliers] = useState([])
  const [getRate, setGetRate] = useState(() => () => 9)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase
      .from('suppliers')
      .select('id, name, gst_registered')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSuppliers(data ?? []))
    fetchRateHistory().then((rates) => setGetRate(() => buildRateResolver(rates)))
  }, [])

  const amountBeforeGst = Number(form.amount_before_gst) || 0
  const rate = getRate(form.date)
  const gstAmount = form.gst_applicable ? round2(amountBeforeGst * (rate / 100)) : 0
  const total = round2(amountBeforeGst + gstAmount)

  function handleSupplierChange(supplierId) {
    const supplier = suppliers.find((s) => s.id === supplierId)
    setForm({ ...form, supplier_id: supplierId, gst_applicable: supplier ? supplier.gst_registered : true })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)

    const { error: purchaseError } = await supabase.from('purchases').insert({
      date: form.date,
      supplier_id: form.supplier_id,
      amount_before_gst: amountBeforeGst,
      gst_amount: gstAmount,
      gst_applicable: form.gst_applicable,
      payment_type: form.payment_type,
      source: 'manual',
      note: form.note || null,
    })

    setSaving(false)
    if (purchaseError) {
      setError(purchaseError.message)
      return
    }

    setSuccess(`Purchase recorded — total S$${total.toFixed(2)} (S$${amountBeforeGst.toFixed(2)} + S$${gstAmount.toFixed(2)} GST)`)
    setForm({ ...emptyForm, date: form.date })
  }

  return (
    <div className="card">
      <h3>New Purchase</h3>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: '-0.5rem' }}>
        Enter the bill amount before GST — if GST applies, it's calculated and added on top to show
        the real total, and tracked separately for your GST returns (input tax).
      </p>
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </label>
        <label>
          Supplier
          <select value={form.supplier_id} onChange={(e) => handleSupplierChange(e.target.value)} required>
            <option value="">Select…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount before GST (SGD)
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount_before_gst}
            onChange={(e) => setForm({ ...form, amount_before_gst: e.target.value })}
            required
          />
        </label>
        <label>
          <span style={{ display: 'block', marginBottom: '0.3rem' }}>GST Applicable?</span>
          <select
            value={form.gst_applicable ? 'yes' : 'no'}
            onChange={(e) => setForm({ ...form, gst_applicable: e.target.value === 'yes' })}
          >
            <option value="yes">Yes — add GST ({rate}%)</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          GST Amount
          <input value={formatMoney(gstAmount)} disabled />
        </label>
        <label>
          Total (Bill Amount)
          <input value={formatMoney(total)} disabled />
        </label>
        <label>
          Payment Type
          <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
            <option>Cash</option>
            <option>Bank</option>
            <option>Credit</option>
          </select>
        </label>
        <label>
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Record Purchase'}
        </button>
      </form>
      {form.payment_type === 'Credit' && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          This will increase what you owe this supplier.
        </p>
      )}
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        This entry won't update Inventory stock automatically (no product attached). Use{' '}
        <strong>Inventory → Stock Movements</strong> if you also need to log stock-in for this
        delivery.
      </p>
      {error && <div className="inline-error">{error}</div>}
      {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
    </div>
  )
}
