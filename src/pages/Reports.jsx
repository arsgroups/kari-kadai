import Tabs from '../components/Tabs'
import DashboardTab from './reports/DashboardTab'
import PnLTab from './reports/PnLTab'
import DrilldownTab from './reports/DrilldownTab'

export default function Reports() {
  return (
    <div className="page">
      <h1>Reports</h1>
      <Tabs
        tabs={[
          { key: 'dashboard', label: 'Dashboard', content: <DashboardTab /> },
          { key: 'pnl', label: 'P&L', content: <PnLTab /> },
          { key: 'drilldown', label: 'Drill-down Builder', content: <DrilldownTab /> },
        ]}
      />
    </div>
  )
}
