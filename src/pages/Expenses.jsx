import { useEffect, useState } from 'react'
import Tabs from '../components/Tabs'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/format'
import ExpenseEntryTab from './expenses/ExpenseEntryTab'
import MonthlySummaryTab from './expenses/MonthlySummaryTab'

export default function Expenses() {
  const [pettyBalance, setPettyBalance] = useState(null)

  useEffect(() => {
    supabase
      .from('v_petty_cash_balance')
      .select('balance')
      .single()
      .then(({ data }) => setPettyBalance(data?.balance ?? 0))
  }, [])

  return (
    <div className="page">
      <h1>Expenses</h1>
      {pettyBalance !== null && (
        <div className="summary-tiles">
          <div className="tile">
            <div className="tile-label">Petty Cash Balance</div>
            <div className="tile-value">{formatMoney(pettyBalance)}</div>
          </div>
        </div>
      )}
      <Tabs
        tabs={[
          { key: 'entry', label: 'Log Expense', content: <ExpenseEntryTab /> },
          { key: 'summary', label: 'Monthly Summary', content: <MonthlySummaryTab /> },
        ]}
      />
    </div>
  )
}
