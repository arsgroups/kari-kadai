import Tabs from '../components/Tabs'
import SupplierMasterTab from './suppliers/SupplierMasterTab'
import SupplierPaymentsTab from './suppliers/SupplierPaymentsTab'

export default function Suppliers() {
  return (
    <div className="page">
      <h1>Suppliers</h1>
      <Tabs
        tabs={[
          { key: 'master', label: 'Suppliers', content: <SupplierMasterTab /> },
          { key: 'payments', label: 'Record Payment', content: <SupplierPaymentsTab /> },
        ]}
      />
    </div>
  )
}
