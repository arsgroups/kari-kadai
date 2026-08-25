import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { round2 } from '../../lib/gst'
import { formatMoney, toISODate } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'
import ReportPrintHeader from '../../components/ReportPrintHeader'

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

    const [{ data: sales }, { data: purchases }, { data: expenseRows }] = await Promise.all([
      supabase.from('sale_invoices').select('date, total').gte('date', from).lte('date', to),
      supabase.from('purchase_invoices').select('date, total').gte('date', from).lte('date', to),
      supabase.from('expenses').select('amount').eq('entry_type', 'expense').gte('date', from).lte('date', to),
    ])

    // Full invoice totals -- no GST/surcharge deducted, matching the Sales
    // and Purchases reports exactly.
    const revenue = (sales ?? []).reduce((sum, s) => sum + s.total, 0)
    const cogs = (purchases ?? []).reduce((sum, p) => sum + p.total, 0)

    const expenseTotal = (expenseRows ?? []).reduce((sum, e) => sum + e.amount, 0)

    const grossPnl = round2(revenue - cogs)
    const netPnl = round2(grossPnl - expenseTotal)

    setResult({
      revenue: round2(revenue),
      cogs: round2(cogs),
      grossPnl,
      expenseTotal: round2(expenseTotal),
      netPnl,
    })
    setLoading(false)
  }

  const exportRows = result
    ? [
        { line: 'Sales', amount: result.revenue },
        { line: 'Purchases', amount: -result.cogs },
        { line: 'Gross P&L', amount: result.grossPnl },
        { line: 'Expenses', amount: -result.expenseTotal },
        { line: 'Net P&L', amount: result.netPnl },
      ]
    : []

  return (
    <div>
      <ReportPrintHeader title="Profit & Loss" />
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
            { key: 'amount', label: 'Amount (SGD)', money: true },
          ]}
          rows={exportRows}
        />
      </div>

      {loading || !result ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="card">
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Sales and Purchases are the full invoice totals — nothing is deducted for GST or the
            Restaurant surcharge, matching the Sales and Purchases reports exactly.
          </p>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              <tr>
                <td>Sales</td>
                <td>{formatMoney(result.revenue)}</td>
              </tr>
              <tr>
                <td>− Purchases</td>
                <td>{formatMoney(result.cogs)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>= Gross P&L</td>
                <td>{formatMoney(result.grossPnl)}</td>
              </tr>
              <tr>
                <td colSpan={2}>&nbsp;</td>
              </tr>
              <tr>
                <td>− Expenses</td>
                <td>{formatMoney(result.expenseTotal)}</td>
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
