import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatMoney } from '../../lib/format'
import ExportButtons from '../../components/ExportButtons'

export default function MonthlySummaryTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('expenses')
      .select('date, amount, expense_categories(classification)')
      .eq('scope', 'monthly')
      .eq('entry_type', 'expense')
    const byMonth = {}
    ;(data ?? []).forEach((row) => {
      const key = row.date?.slice(0, 7)
      if (!byMonth[key]) byMonth[key] = { month: key, fixed: 0, variable: 0 }
      byMonth[key][row.expense_categories?.classification ?? 'variable'] += row.amount
    })
    const list = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month))
    setRows(list)
    setLoading(false)
  }

  const exportRows = rows.map((r) => ({
    month: r.month,
    fixed: r.fixed,
    variable: r.variable,
    total: r.fixed + r.variable,
  }))

  return (
    <div>
      <div className="toolbar">
        <ExportButtons
          title="Monthly Expense Summary"
          filename="monthly_expense_summary"
          columns={[
            { key: 'month', label: 'Month' },
            { key: 'fixed', label: 'Fixed', money: true },
            { key: 'variable', label: 'Variable', money: true },
            { key: 'total', label: 'Total', money: true },
          ]}
          rows={exportRows}
        />
      </div>
      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Fixed</th>
                <th>Variable</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{formatMoney(r.fixed)}</td>
                  <td>{formatMoney(r.variable)}</td>
                  <td>{formatMoney(r.fixed + r.variable)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No data yet.
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
