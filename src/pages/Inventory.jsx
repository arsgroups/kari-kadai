import Tabs from '../components/Tabs'
import ProductsTab from './inventory/ProductsTab'
import StockMovementsTab from './inventory/StockMovementsTab'
import StockVerificationTab from './inventory/StockVerificationTab'
import YieldConfigurationTab from './inventory/YieldConfigurationTab'
import ProcessingEventsTab from './inventory/ProcessingEventsTab'

export default function Inventory() {
  return (
    <div className="page">
      <h1>Inventory</h1>
      <Tabs
        tabs={[
          { key: 'products', label: 'Products', content: <ProductsTab /> },
          { key: 'movements', label: 'Stock Movements', content: <StockMovementsTab /> },
          { key: 'verification', label: 'Stock Verification', content: <StockVerificationTab /> },
          { key: 'yield-config', label: 'Yield Configuration', content: <YieldConfigurationTab /> },
          { key: 'processing', label: 'Process / Cut Stock', content: <ProcessingEventsTab /> },
        ]}
      />
    </div>
  )
}
