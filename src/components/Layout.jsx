import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { COMPANY } from '../lib/companyInfo'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/inventory', label: 'Inventory' },
  { to: '/sales', label: 'Sales' },
  { to: '/purchases', label: 'Purchases' },
  { to: '/customers', label: 'Customers & Credit' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/closing', label: 'Daily Closing' },
  { to: '/gst', label: 'GST' },
  { to: '/reports', label: 'Reports' },
  { to: '/import', label: 'Import from Accounting App' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { user, signOut, devAutoLoginActive } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

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
