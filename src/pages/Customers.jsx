import Tabs from '../components/Tabs'
import CustomerMasterTab from './customers/CustomerMasterTab'
import CustomerPricingTab from './customers/CustomerPricingTab'
import CustomerPaymentsTab from './customers/CustomerPaymentsTab'
import OutstandingReportTab from './customers/OutstandingReportTab'

export default function Customers() {
  return (
    <div className="page">
      <h1>Customers & Credit</h1>
      <Tabs
        tabs={[
          { key: 'master', label: 'Customers', content: <CustomerMasterTab /> },
          { key: 'pricing', label: 'Customer Pricing', content: <CustomerPricingTab /> },
          { key: 'payments', label: 'Record Payment', content: <CustomerPaymentsTab /> },
          { key: 'outstanding', label: 'Outstanding Report', content: <OutstandingReportTab /> },
        ]}
      />
    </div>
  )
}
