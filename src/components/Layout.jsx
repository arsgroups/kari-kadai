import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { COMPANY } from '../lib/companyInfo'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/inventory', label: 'Inventory' },
  { to: '/sales', label: 'Sales' },
  { to: '/quotations', label: 'Quotation Generator' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/promotions', label: 'Promotions', adminOnly: true },
  { to: '/customers', label: 'Customers & Credit' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/expenses/daily', label: 'Daily Expenses' },
  { to: '/expenses/monthly', label: 'Monthly Expenses', adminOnly: true },
  { to: '/closing', label: 'Daily Closing' },
  { to: '/reports', label: 'Reports', adminOnly: true },
  { to: '/settings', label: 'Settings', adminOnly: true },
  { to: '/audit-log', label: 'Audit Log', adminOnly: true },
]

export default function Layout() {
  const { user, signOut, devAutoLoginActive, isAdmin, role, roleDebug } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)

  // Close the mobile sidebar whenever the route changes (e.g. after tapping a nav link).
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  return (
    <div className="app-shell">
      <header className="mobile-topbar no-print">
        <button
          className="hamburger-btn"
          aria-label="Open menu"
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <span className="mobile-topbar-title">{COMPANY.name}</span>
      </header>

      {sidebarOpen && <div className="sidebar-backdrop no-print" onClick={() => setSidebarOpen(false)} />}

      <aside className={sidebarOpen ? 'sidebar sidebar-open no-print' : 'sidebar no-print'}>
        <div className="sidebar-header">
          <h2>{COMPANY.name}</h2>
          <button
            className="sidebar-close-btn"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>
        {devAutoLoginActive && (
          <div className="dev-banner">DEV AUTO-LOGIN — local only, never in production</div>
        )}
        <nav>
          {visibleNavItems.map((item) => (
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
          <div className="user-email" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
            Role: {role} ({roleDebug || 'checking…'})
          </div>
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
