import { useState } from 'react'

export default function Tabs({ tabs, defaultTab }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0].key)
  const activeTab = tabs.find((t) => t.key === active)

  return (
    <div>
      <div className="toolbar" style={{ borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={active === t.key ? 'btn' : 'btn-secondary'}
          >
            {t.label}
          </button>
        ))}
      </div>
      {activeTab?.content}
    </div>
  )
}
