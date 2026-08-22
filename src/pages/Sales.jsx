import Tabs from '../components/Tabs'
import NewSaleInvoiceTab from './sales/NewSaleInvoiceTab'
import SaleInvoicesListTab from './sales/SaleInvoicesListTab'
import NewSalesReturnTab from './sales/NewSalesReturnTab'
import SalesReturnsListTab from './sales/SalesReturnsListTab'

export default function Sales() {
  return (
    <div className="page">
      <h1>Sales</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Sale Invoice', content: <NewSaleInvoiceTab /> },
          { key: 'list', label: 'Sale Invoices', content: <SaleInvoicesListTab /> },
          { key: 'new-return', label: 'New Sales Return', content: <NewSalesReturnTab /> },
          { key: 'returns', label: 'Sales Returns', content: <SalesReturnsListTab /> },
        ]}
      />
    </div>
  )
}
