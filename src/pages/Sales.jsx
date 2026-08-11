import Tabs from '../components/Tabs'
import NewSaleInvoiceTab from './sales/NewSaleInvoiceTab'
import SaleInvoicesListTab from './sales/SaleInvoicesListTab'
import ChannelItemsTab from './sales/ChannelItemsTab'

export default function Sales() {
  return (
    <div className="page">
      <h1>Sales</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Sale Invoice', content: <NewSaleInvoiceTab /> },
          { key: 'list', label: 'Sale Invoices', content: <SaleInvoicesListTab /> },
          { key: 'channel-items', label: 'Channel Items', content: <ChannelItemsTab /> },
        ]}
      />
    </div>
  )
}
