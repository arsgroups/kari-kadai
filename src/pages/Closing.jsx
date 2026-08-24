import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatMoney, toISODate } from '../lib/format'
import { useAuth } from '../contexts/AuthContext'
import DailyClosingReport from './closing/DailyClosingReport'

export default function Closing() {
  const { user } = useAuth()
  const [date, setDate] = useState(toISODate())
  const [showReport, setShowReport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [cashSales, setCashSales] = useState(0)
  const [bankSales, setBankSales] = useState(0)
  const [creditSales, setCreditSales] = useState(0)
  const [pettyCashSpent, setPettyCashSpent] = useState(0)
  const [cashCreditCollected, setCashCreditCollected] = useState(0)
  const [openingCash, setOpeningCash] = useState(0)
  const [actualCounted, setActualCounted] = useState('')
  const [note, setNote] = useState('')
  const [existingRecordId, setExistingRecordId] = useState(null)
  const [totalOutstanding, setTotalOutstanding] = useState(0)
  const [totalPayable, setTotalPayable] = useState(0)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  async function load() {
    setLoading(true)
    setError('')

    const [salesRes, pettyRes, closingRes, prevClosingRes, outstandingRes, payableRes, creditPaymentsRes] =
      await Promise.all([
        supabase.from('sale_invoices').select('total, payment_type').eq('date', date),
        supabase
          .from('expenses')
          .select('amount')
          .eq('date', date)
          .eq('entry_type', 'expense')
          .eq('scope', 'daily'),
        supabase.from('daily_closing').select('*').eq('date', date).maybeSingle(),
        supabase
          .from('daily_closing')
          .select('actual_cash_counted')
          .lt('date', date)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('v_customer_outstanding').select('outstanding'),
        supabase.from('v_supplier_outstanding').select('outstanding'),
        supabase.from('customer_payments').select('amount, payment_type').eq('date', date),
      ])

    const sales = salesRes.data ?? []
    setCashSales(sales.filter((s) => s.payment_type === 'Cash').reduce((sum, s) => sum + s.total, 0))
    setBankSales(sales.filter((s) => s.payment_type === 'Bank').reduce((sum, s) => sum + s.total, 0))
    setCreditSales(sales.filter((s) => s.payment_type === 'Credit').reduce((sum, s) => sum + s.total, 0))

    setPettyCashSpent((pettyRes.data ?? []).reduce((sum, p) => sum + p.amount, 0))
    setCashCreditCollected(
      (creditPaymentsRes.data ?? []).filter((p) => p.payment_type === 'Cash').reduce((sum, p) => sum + p.amount, 0)
    )
    setOpeningCash(prevClosingRes.data?.actual_cash_counted ?? 0)

    if (closingRes.data) {
      setExistingRecordId(closingRes.data.id)
      setActualCounted(closingRes.data.actual_cash_counted ?? '')
      setNote(closingRes.data.note ?? '')
    } else {
      setExistingRecordId(null)
      setActualCounted('')
      setNote('')
    }

    setTotalOutstanding((outstandingRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))
    setTotalPayable((payableRes.data ?? []).reduce((sum, r) => sum + r.outstanding, 0))

    setLoading(false)
  }

  const cashSalesNum = cashSales
  const expectedCash = openingCash + cashSalesNum + cashCreditCollected - pettyCashSpent
  const variance = actualCounted === '' ? null : Number(actualCounted) - expectedCash

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      date,
      actual_cash_counted: actualCounted === '' ? null : Number(actualCounted),
      note: note || null,
    }
    const { error } = existingRecordId
      ? await supabase.from('daily_closing').update(payload).eq('id', existingRecordId)
      : await supabase.from('daily_closing').insert(payload)
    setSaving(false)
    if (error) setError(error.message)
    else load()
  }

  if (showReport) {
    return (
      <div className="page">
        <DailyClosingReport date={date} operatorEmail={user?.email} onClose={() => setShowReport(false)} />
      </div>
    )
  }

  return (
    <div className="page">
      <h1>Daily Closing</h1>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: '0.5rem' }} />
          </label>
          <button className="btn-secondary" onClick={() => setShowReport(true)}>
            View / Print Daily Closing Report
          </button>
        </div>
      </div>

      <div className="summary-tiles">
        <div className="tile">
          <div className="tile-label">Cash in Hand (Actual)</div>
          <div className="tile-value">{formatMoney(actualCounted === '' ? expectedCash : Number(actualCounted))}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Total Outstanding (Customers)</div>
          <div className="tile-value">{formatMoney(totalOutstanding)}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Total Payable (Suppliers)</div>
          <div className="tile-value">{formatMoney(totalPayable)}</div>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card">
          <h3>Cash Reconciliation for {date}</h3>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              <tr>
                <td>Opening Cash (yesterday's counted cash)</td>
                <td>{formatMoney(openingCash)}</td>
              </tr>
              <tr>
                <td>+ Cash Sales Today</td>
                <td>{formatMoney(cashSalesNum)}</td>
              </tr>
              <tr>
                <td>+ Cash Collected from Old Credit Today</td>
                <td>{formatMoney(cashCreditCollected)}</td>
              </tr>
              <tr>
                <td>− Daily Expenses Today</td>
                <td>{formatMoney(pettyCashSpent)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Expected Cash in Hand</td>
                <td>{formatMoney(expectedCash)}</td>
              </tr>
              <tr>
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>Bank Sales Today</td>
                <td>{formatMoney(bankSales)}</td>
              </tr>
              <tr>
                <td>Credit Sales Today</td>
                <td>{formatMoney(creditSales)}</td>
              </tr>
            </tbody>
          </table>

          <form className="form-grid" onSubmit={handleSave} style={{ marginTop: '1.25rem' }}>
            <label>
              Actual Counted Cash
              <input
                type="number"
                step="0.01"
                value={actualCounted}
                onChange={(e) => setActualCounted(e.target.value)}
              />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : existingRecordId ? 'Update Closing' : 'Save Closing'}
            </button>
          </form>

          {variance !== null && (
            <p style={{ marginTop: '1rem' }}>
              Variance:{' '}
              <span className={variance === 0 ? 'tag tag-success' : 'tag tag-danger'}>
                {variance > 0 ? '+' : ''}
                {formatMoney(variance)}
              </span>
            </p>
          )}
          {error && <div className="inline-error">{error}</div>}
        </div>
      )}
    </div>
  )
}
