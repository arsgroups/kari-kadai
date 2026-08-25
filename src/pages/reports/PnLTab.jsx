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
      supabase
        .from('expenses')
        .select('amount, scope, expense_categories(name)')
        .eq('entry_type', 'expense')
        .gte('date', from)
        .lte('date', to),
    ])

    // Full invoice totals -- no GST/surcharge deducted, matching the Sales
    // and Purchases reports exactly.
    const revenue = (sales ?? []).reduce((sum, s) => sum + s.total, 0)
    const cogs = (purchases ?? []).reduce((sum, p) => sum + p.total, 0)

    const expenseTotal = (expenseRows ?? []).reduce((sum, e) => sum + e.amount, 0)
    const dailyExpenseTotal = (expenseRows ?? [])
      .filter((e) => e.scope === 'daily')
      .reduce((sum, e) => sum + e.amount, 0)
    const monthlyExpenseTotal = (expenseRows ?? [])
      .filter((e) => e.scope === 'monthly')
      .reduce((sum, e) => sum + e.amount, 0)

    const byCategory = {}
    ;(expenseRows ?? []).forEach((e) => {
      const name = e.expense_categories?.name ?? 'Uncategorized'
      byCategory[name] = (byCategory[name] ?? 0) + e.amount
    })
    const expenseByCategory = Object.entries(byCategory)
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount)

    const grossPnl = round2(revenue - cogs)
    const netPnl = round2(grossPnl - expenseTotal)

    setResult({
      revenue: round2(revenue),
      cogs: round2(cogs),
      grossPnl,
      expenseTotal: round2(expenseTotal),
      dailyExpenseTotal: round2(dailyExpenseTotal),
      monthlyExpenseTotal: round2(monthlyExpenseTotal),
      expenseByCategory,
      netPnl,
    })
    setLoading(false)
  }

  const exportRows = result
    ? [
        { line: 'Sales', amount: result.revenue },
        { line: 'Purchases', amount: -result.cogs },
        { line: 'Gross P&L', amount: result.grossPnl },
        { line: 'Daily Expenses', amount: -result.dailyExpenseTotal },
        { line: 'Monthly Expenses', amount: -result.monthlyExpenseTotal },
        ...result.expenseByCategory.map((c) => ({ line: `  — ${c.name}`, amount: -c.amount })),
        { line: 'Total Expenses', amount: -result.expenseTotal },
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
                <td>Daily Expenses</td>
                <td>{formatMoney(result.dailyExpenseTotal)}</td>
              </tr>
              <tr>
                <td>Monthly Expenses</td>
                <td>{formatMoney(result.monthlyExpenseTotal)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>− Total Expenses</td>
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

          <h3 style={{ marginTop: '1.5rem' }}>Expense Breakdown by Category</h3>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>
            Every expense in the range (daily and monthly together), grouped by category — e.g. Fuel,
            Salary, Room Rent each as one line.
          </p>
          <table className="data-table" style={{ maxWidth: 480 }}>
            <tbody>
              {result.expenseByCategory.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{formatMoney(c.amount)}</td>
                </tr>
              ))}
              {result.expenseByCategory.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    No expenses in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
