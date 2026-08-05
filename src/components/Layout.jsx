import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/inventory', label: 'Inventory' },
  { to: '/sales', label: 'Sales' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/petty-cash', label: 'Petty Cash' },
  { to: '/customers', label: 'Customers & Credit' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/expenses', label: 'Monthly Expenses' },
  { to: '/closing', label: 'Daily Closing' },
  { to: '/gst', label: 'GST' },
  { to: '/reports', label: 'Reports' },
  { to: '/import', label: 'Import from Accounting App' },
]

export default function Layout() {
  const { user, signOut, devAutoLoginActive } = useAuth()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Kari Kadai</h2>
        </div>
        {devAutoLoginActive && (
          <div className="dev-banner">DEV AUTO-LOGIN — local only, never in production</div>
        )}
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email">{user?.email}</div>
          <button className="signout-btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
