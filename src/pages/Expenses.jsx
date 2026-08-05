import Tabs from '../components/Tabs'
import ExpenseEntryTab from './expenses/ExpenseEntryTab'
import MonthlySummaryTab from './expenses/MonthlySummaryTab'

export default function Expenses() {
  return (
    <div className="page">
      <h1>Monthly Fixed & Variable Expenses</h1>
      <Tabs
        tabs={[
          { key: 'entry', label: 'Entry', content: <ExpenseEntryTab /> },
          { key: 'summary', label: 'Monthly Summary', content: <MonthlySummaryTab /> },
        ]}
      />
    </div>
  )
}
