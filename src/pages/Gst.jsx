import Tabs from '../components/Tabs'
import GstReturnsTab from './gst/GstReturnsTab'
import GstRateSettingsTab from './gst/GstRateSettingsTab'

export default function Gst() {
  return (
    <div className="page">
      <h1>GST (IRAS Quarterly Filing)</h1>
      <Tabs
        tabs={[
          { key: 'returns', label: 'GST Returns', content: <GstReturnsTab /> },
          { key: 'rates', label: 'Rate Settings', content: <GstRateSettingsTab /> },
        ]}
      />
    </div>
  )
}
