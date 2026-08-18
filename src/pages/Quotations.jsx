import Tabs from '../components/Tabs'
import NewQuotationTab from './quotations/NewQuotationTab'
import QuotationsListTab from './quotations/QuotationsListTab'

export default function Quotations() {
  return (
    <div className="page">
      <h1>Quotation Generator</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Quotation', content: <NewQuotationTab /> },
          { key: 'list', label: 'Quotations', content: <QuotationsListTab /> },
        ]}
      />
    </div>
  )
}
