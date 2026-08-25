import Tabs from '../components/Tabs'
import DashboardTab from './reports/DashboardTab'
import PnLTab from './reports/PnLTab'
import DrilldownTab from './reports/DrilldownTab'
import CustomerLedgerTab from './reports/CustomerLedgerTab'
import SupplierLedgerTab from './reports/SupplierLedgerTab'
import InventoryValuationTab from './reports/InventoryValuationTab'
import ItemMarginTab from './reports/ItemMarginTab'
import ChannelMarginTab from './reports/ChannelMarginTab'
import PromotionSpendTab from './reports/PromotionSpendTab'

export default function Reports() {
  return (
    <div className="page">
      <h1>Reports</h1>
      <Tabs
        tabs={[
          { key: 'dashboard', label: 'Dashboard', content: <DashboardTab /> },
          { key: 'pnl', label: 'P&L', content: <PnLTab /> },
          { key: 'item-margin', label: 'Item Margin', content: <ItemMarginTab /> },
          { key: 'channel-margin', label: 'Channel Sales & Margin', content: <ChannelMarginTab /> },
          { key: 'promotion-spend', label: 'Promotion Spend', content: <PromotionSpendTab /> },
          { key: 'drilldown', label: 'Drill-down Builder', content: <DrilldownTab /> },
          { key: 'customer-ledger', label: 'Customer Ledger', content: <CustomerLedgerTab /> },
          { key: 'supplier-ledger', label: 'Supplier Ledger', content: <SupplierLedgerTab /> },
          { key: 'valuation', label: 'Inventory Valuation', content: <InventoryValuationTab /> },
        ]}
      />
    </div>
  )
}
