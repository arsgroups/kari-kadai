import Tabs from '../components/Tabs'
import MonthlyExpenseEntryTab from './monthly-expenses/MonthlyExpenseEntryTab'
import MonthlySummaryTab from './monthly-expenses/MonthlySummaryTab'

export default function MonthlyExpenses() {
  return (
    <div className="page">
      <h1>Monthly Expenses</h1>
      <p className="muted" style={{ marginTop: '-0.5rem' }}>
        Recurring monthly costs (Salary, Rent, CPF, Levy, GST payable, ...). Intended for management
        visibility only.
      </p>
      <Tabs
        tabs={[
          { key: 'entry', label: 'Log Expense', content: <MonthlyExpenseEntryTab /> },
          { key: 'summary', label: 'Monthly Summary', content: <MonthlySummaryTab /> },
        ]}
      />
    </div>
  )
}
