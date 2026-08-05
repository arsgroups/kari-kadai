import Tabs from '../components/Tabs'
import CsvImportTab from './import/CsvImportTab'
import ManualTotalTab from './import/ManualTotalTab'
import HelpTab from './import/HelpTab'

export default function Import() {
  return (
    <div className="page">
      <h1>Import from Accounting App</h1>
      <Tabs
        tabs={[
          { key: 'csv', label: 'CSV Import', content: <CsvImportTab /> },
          { key: 'manual', label: 'Manual Total Entry', content: <ManualTotalTab /> },
          { key: 'help', label: 'Help', content: <HelpTab /> },
        ]}
      />
    </div>
  )
}
