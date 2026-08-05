import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchRateHistory, buildRateResolver, netOfGst, gstPortion, round2 } from '../../lib/gst'
import { formatDate, formatMoney, toISODate } from '../../lib/format'

// Suggests the next unfiled calendar quarter, e.g. if today is in Q1 it suggests Q1 (Jan-Mar).
function suggestQuarter() {
  const today = new Date()
  const q = Math.floor(today.getMonth() / 3)
  const start = new Date(today.getFullYear(), q * 3, 1)
  const end = new Date(today.getFullYear(), q * 3 + 3, 0)
  const due = new Date(end)
  due.setMonth(due.getMonth() + 1)
  return { start: toISODate(start), end: toISODate(end), due: toISODate(due) }
}

const emptyReturn = {
  id: null,
  period_start: suggestQuarter().start,
  period_end: suggestQuarter().end,
  due_date: suggestQuarter().due,
  box1_standard_rated_supplies: 0,
  box2_zero_rated_supplies: 0,
  box3_exempt_supplies: 0,
  total_revenue: 0,
  box5_taxable_purchases: 0,
  box6_output_tax_due: 0,
  box7_input_tax_and_refunds: 0,
  status: 'draft',
}

export default function GstReturnsTab() {
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyReturn)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('gst_returns').select('*').order('period_start', { ascending: false })
    if (error) setError(error.message)
    else setReturns(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function selectReturn(r) {
    setForm(r)
  }

  function newReturn() {
    const q = suggestQuarter()
    setForm({ ...emptyReturn, period_start: q.start, period_end: q.end, due_date: q.due })
  }

  async function generateDraft() {
    setGenerating(true)
    setError('')

    const rateRows = await fetchRateHistory()
    const getRate = buildRateResolver(rateRows)

    const [{ data: sales, error: salesErr }, { data: purchases, error: purchErr }] = await Promise.all([
      supabase
        .from('sales')
        .select('date, total, gst_applicable')
        .gte('date', form.period_start)
        .lte('date', form.period_end),
      supabase
        .from('purchases')
        .select('date, total, amount_before_gst, gst_amount, gst_applicable')
        .gte('date', form.period_start)
        .lte('date', form.period_end),
    ])

    if (salesErr || purchErr) {
      setError((salesErr || purchErr).message)
      setGenerating(false)
      return
    }

    let box1 = 0
    let box6 = 0
    ;(sales ?? []).forEach((s) => {
      if (!s.gst_applicable) return
      const rate = getRate(s.date)
      box1 += netOfGst(s.total, rate)
      box6 += gstPortion(s.total, rate)
    })

    // Purchases now store amount_before_gst / gst_amount directly (GST is added on top at
    // entry time). Fall back to extracting it from the total for any older rows that predate
    // that change.
    let box5 = 0
    let box7 = 0
    ;(purchases ?? []).forEach((p) => {
      if (!p.gst_applicable) return
      if (p.amount_before_gst != null) {
        box5 += p.amount_before_gst
        box7 += p.gst_amount ?? 0
      } else {
        const rate = getRate(p.date)
        box5 += netOfGst(p.total, rate)
        box7 += gstPortion(p.total, rate)
      }
    })

    box1 = round2(box1)
    box5 = round2(box5)
    box6 = round2(box6)
    box7 = round2(box7)

    const totalRevenue = round2(box1 + form.box2_zero_rated_supplies + form.box3_exempt_supplies)

    setForm({
      ...form,
      box1_standard_rated_supplies: box1,
      box5_taxable_purchases: box5,
      box6_output_tax_due: box6,
      box7_input_tax_and_refunds: box7,
      total_revenue: totalRevenue,
    })
    setGenerating(false)
  }

  async function handleSave(markFiled) {
    setSaving(true)
    setError('')
    const payload = {
      period_start: form.period_start,
      period_end: form.period_end,
      due_date: form.due_date || null,
      box1_standard_rated_supplies: Number(form.box1_standard_rated_supplies) || 0,
      box2_zero_rated_supplies: Number(form.box2_zero_rated_supplies) || 0,
      box3_exempt_supplies: Number(form.box3_exempt_supplies) || 0,
      total_revenue: Number(form.total_revenue) || 0,
      box5_taxable_purchases: Number(form.box5_taxable_purchases) || 0,
      box6_output_tax_due: Number(form.box6_output_tax_due) || 0,
      box7_input_tax_and_refunds: Number(form.box7_input_tax_and_refunds) || 0,
      status: markFiled ? 'filed' : form.status,
      filed_date: markFiled ? toISODate() : form.filed_date ?? null,
      note: form.note ?? null,
    }

    const { error } = form.id
      ? await supabase.from('gst_returns').update(payload).eq('id', form.id)
      : await supabase.from('gst_returns').insert(payload)

    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    load()
    if (!form.id) newReturn()
  }

  const box8 = round2((Number(form.box6_output_tax_due) || 0) - (Number(form.box7_input_tax_and_refunds) || 0))

  return (
    <div>
      <div className="toolbar">
        <button className="btn-secondary" onClick={newReturn}>
          + New Quarter
        </button>
      </div>

      <div className="card">
        <h3>{form.id ? `GST Return — ${form.period_start} to ${form.period_end}` : 'New GST Return'}</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: '-0.5rem' }}>
          Mirrors IRAS GST F5. "Generate Draft" pulls Boxes 1, 5, 6, 7 from your Sales/Purchases for the
          period — every box stays editable before you file, and editing here never changes your Sales or
          Purchases records or your P&amp;L.
        </p>

        <div className="form-grid">
          <label>
            Period Start
            <input
              type="date"
              value={form.period_start}
              onChange={(e) => setForm({ ...form, period_start: e.target.value })}
            />
          </label>
          <label>
            Period End
            <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
          </label>
          <label>
            Filing Due Date
            <input type="date" value={form.due_date ?? ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </label>
          <button type="button" className="btn-secondary" onClick={generateDraft} disabled={generating}>
            {generating ? 'Calculating…' : 'Generate Draft from Sales/Purchases'}
          </button>
        </div>

        <table className="data-table" style={{ marginTop: '1.25rem', maxWidth: 560 }}>
          <tbody>
            <tr>
              <td>Box 1 — Standard-rated supplies (excl. GST)</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box1_standard_rated_supplies}
                  onChange={(e) => setForm({ ...form, box1_standard_rated_supplies: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Box 2 — Zero-rated supplies</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box2_zero_rated_supplies}
                  onChange={(e) => setForm({ ...form, box2_zero_rated_supplies: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Box 3 — Exempt supplies</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box3_exempt_supplies}
                  onChange={(e) => setForm({ ...form, box3_exempt_supplies: e.target.value })}
                />
              </td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Box 4 — Total supplies (1+2+3)</td>
              <td>
                {formatMoney(
                  (Number(form.box1_standard_rated_supplies) || 0) +
                    (Number(form.box2_zero_rated_supplies) || 0) +
                    (Number(form.box3_exempt_supplies) || 0)
                )}
              </td>
            </tr>
            <tr>
              <td>Total Revenue (IRAS revenue declaration)</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.total_revenue}
                  onChange={(e) => setForm({ ...form, total_revenue: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Box 5 — Taxable purchases (excl. GST)</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box5_taxable_purchases}
                  onChange={(e) => setForm({ ...form, box5_taxable_purchases: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Box 6 — Output tax due</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box6_output_tax_due}
                  onChange={(e) => setForm({ ...form, box6_output_tax_due: e.target.value })}
                />
              </td>
            </tr>
            <tr>
              <td>Box 7 — Input tax and refunds claimed</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  value={form.box7_input_tax_and_refunds}
                  onChange={(e) => setForm({ ...form, box7_input_tax_and_refunds: e.target.value })}
                />
              </td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Box 8 — Net GST {box8 >= 0 ? 'payable' : 'claimable'}</td>
              <td>
                <span className={box8 >= 0 ? 'tag tag-warning' : 'tag tag-success'}>{formatMoney(Math.abs(box8))}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="toolbar" style={{ marginTop: '1rem' }}>
          <button className="btn" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
          <button className="btn-secondary" onClick={() => handleSave(true)} disabled={saving}>
            Mark as Filed
          </button>
          <span className={form.status === 'filed' ? 'tag tag-success' : 'tag tag-muted'}>{form.status}</span>
        </div>
        {error && <div className="inline-error">{error}</div>}
      </div>

      <div className="card">
        <h3>Past Returns</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Due Date</th>
                <th>Net GST</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatDate(r.period_start)} – {formatDate(r.period_end)}
                  </td>
                  <td>{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td>
                    {r.box8_net_gst_payable >= 0 ? 'Payable ' : 'Claimable '}
                    {formatMoney(Math.abs(r.box8_net_gst_payable))}
                  </td>
                  <td>
                    <span className={r.status === 'filed' ? 'tag tag-success' : 'tag tag-muted'}>{r.status}</span>
                  </td>
                  <td>
                    <button className="btn-secondary" onClick={() => selectReturn(r)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {returns.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No GST returns yet.
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
