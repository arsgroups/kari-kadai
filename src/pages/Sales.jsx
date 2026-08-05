import Tabs from '../components/Tabs'
import NewSaleInvoiceTab from './sales/NewSaleInvoiceTab'
import SaleInvoicesListTab from './sales/SaleInvoicesListTab'

export default function Sales() {
  return (
    <div className="page">
      <h1>Sales</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Sale Invoice', content: <NewSaleInvoiceTab /> },
          { key: 'list', label: 'Sale Invoices', content: <SaleInvoicesListTab /> },
        ]}
      />
    </div>
  )
}
