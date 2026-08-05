import Tabs from '../components/Tabs'
import NewPurchaseTab from './purchases/NewPurchaseTab'
import PurchasesListTab from './purchases/PurchasesListTab'

export default function Purchases() {
  return (
    <div className="page">
      <h1>Purchases</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Purchase', content: <NewPurchaseTab /> },
          { key: 'list', label: 'Purchases List', content: <PurchasesListTab /> },
        ]}
      />
    </div>
  )
}
