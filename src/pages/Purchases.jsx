import Tabs from '../components/Tabs'
import NewPurchaseInvoiceTab from './purchases/NewPurchaseInvoiceTab'
import PurchaseInvoicesListTab from './purchases/PurchaseInvoicesListTab'

export default function Purchases() {
  return (
    <div className="page">
      <h1>Purchases</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Purchase Invoice', content: <NewPurchaseInvoiceTab /> },
          { key: 'list', label: 'Purchase Invoices', content: <PurchaseInvoicesListTab /> },
        ]}
      />
    </div>
  )
}
