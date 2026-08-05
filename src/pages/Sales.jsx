import Tabs from '../components/Tabs'
import NewSaleTab from './sales/NewSaleTab'
import SalesListTab from './sales/SalesListTab'

export default function Sales() {
  return (
    <div className="page">
      <h1>Sales</h1>
      <Tabs
        tabs={[
          { key: 'new', label: 'New Sale', content: <NewSaleTab /> },
          { key: 'list', label: 'Sales List', content: <SalesListTab /> },
        ]}
      />
    </div>
  )
}
