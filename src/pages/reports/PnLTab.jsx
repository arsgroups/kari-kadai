import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { round2 } from '../../lib/gst'
import { formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

function firstOfMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function PnLTab() {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(toISODate())
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  async function load() {
    setLoading(true)

    const [{ data: sales }, { data: purchases }, { data: pettyCash }, { data: monthlyExpenses }] = await Promise.all([
      supabase.from('sale_invoices').select('date, subtotal').gte('date', from).lte('date', to),
      supabase.from('purchase_invoices').select('date, total, subtotal').gte('date', from).lte('date', to),
      supabase
        .from('petty_cash_entries')
        .select('amount')
        .eq('entry_type', 'expense')
        .gte('date', from)
        .lte('date', to),
      supabase
        .from('monthly_expenses')
        .select('amount')
        .gte('month', from.slice(0, 7) + '-01')
        .lte('month', to.slice(0, 7) + '-01'),
    ])

    // Both sale_invoices.subtotal and purchase_invoices.subtotal are already GST-exclusive
    // (GST is added on top at entry time), so they're used directly with no extraction needed.
    const revenueNet = (sales ?? []).reduce((sum, s) => sum + s.subtotal, 0)
    const cogsNet = (purchases ?? []).reduce((sum, p) => sum + p.subtotal, 0)

    const pettyTotal = (pettyCash ?? []).reduce((sum, p) => sum + p.amount, 0)
    const monthlyTotal = (monthlyExpenses ?? []).reduce((sum, e) => sum + e.amount, 0)

    const grossPnl = round2(revenueNet - cogsNet)
    const netPnl = round2(grossPnl - pettyTotal - monthlyTotal)

    setResult({
      revenueNet: round2(revenueNet),
      cogsNet: round2(cogsNet),
      grossPnl,
      pettyTotal: round2(pettyTotal),
      monthlyTotal: round2(monthlyTotal),
      netPnl,
    })
    setLoading(false)
  }

  const exportRows = result
    ? [
        { line: 'Revenue (net of GST)', amount: result.revenueNet },
        { line: 'COGS (net of GST)', amount: -result.cogsNet },
        { line: 'Gross P&L', amount: result.grossPnl },
        { line: 'Petty Cash Expenses', amount: -result.pettyTotal },
        { line: 'Monthly Fixed & Variable Expenses', amount: -result.monthlyTotal },
        { line: 'Net P&L', amount: result.netPnl },
      ]
    : []

  return (
    <div>
      <div className="card">
        <div className="form-grid">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="toolbar">
        <ExportButtons
          title={`P&L: ${from} to ${to}`}
          filename="profit_and_loss"
          columns={[
            { key: 'line', label: 'Line' },
            { key: 'amount', label: 'Amount (SGD)' },
          ]}
          rows={exportRows}
        />
      </div>

      {loading || !result ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card">
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            All figures are net of GST — GST collected on sales and paid on purchases is excluded, since
            it isn't your revenue or cost, it's held for IRAS.
          </p>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              <tr>
                <td>Revenue (net of GST)</td>
                <td>{formatMoney(result.revenueNet)}</td>
              </tr>
              <tr>
                <td>− COGS (purchases, net of GST)</td>
                <td>{formatMoney(result.cogsNet)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Gross P&L</td>
                <td>{formatMoney(result.grossPnl)}</td>
              </tr>
              <tr>
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>− Petty Cash Expenses</td>
                <td>{formatMoney(result.pettyTotal)}</td>
              </tr>
              <tr>
                <td>− Monthly Fixed & Variable Expenses</td>
                <td>{formatMoney(result.monthlyTotal)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Net P&L</td>
                <td>
                  <span className={result.netPnl >= 0 ? 'tag tag-success' : 'tag tag-danger'}>
                    {formatMoney(result.netPnl)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
