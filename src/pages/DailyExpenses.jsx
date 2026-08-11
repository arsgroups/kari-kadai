import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatMoney } from '../lib/format'
import DailyExpenseEntryTab from './daily-expenses/DailyExpenseEntryTab'

export default function DailyExpenses() {
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
      <h1>Daily Expenses</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Day-to-day spend (fuel, stationery, small purchases). Intended to be visible to shop staff.
      </p>
      {pettyBalance !== null && (
        <div className="summary-tiles">
          <div className="tile">
            <div className="tile-label">Petty Cash Balance</div>
            <div className="tile-value">{formatMoney(pettyBalance)}</div>
          </div>
        </div>
      )}
      <DailyExpenseEntryTab />
    </div>
  )
}
