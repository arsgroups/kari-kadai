import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'
import Login from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Sales = lazy(() => import('./pages/Sales'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Customers = lazy(() => import('./pages/Customers'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const DailyExpenses = lazy(() => import('./pages/DailyExpenses'))
const MonthlyExpenses = lazy(() => import('./pages/MonthlyExpenses'))
const Closing = lazy(() => import('./pages/Closing'))
const Gst = lazy(() => import('./pages/Gst'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Promotions = lazy(() => import('./pages/Promotions'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const Quotations = lazy(() => import('./pages/Quotations'))
const Capital = lazy(() => import('./pages/Capital'))
const WebsiteOrders = lazy(() => import('./pages/WebsiteOrders'))

function RouteFallback() {
  return <p className="muted" style={{ padding: '2rem' }}>Loading…</p>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="sales" element={<Sales />} />
              <Route path="quotations" element={<Quotations />} />
              <Route path="purchases" element={<Purchases />} />
              <Route path="website-orders" element={<WebsiteOrders />} />
              <Route path="petty-cash" element={<Navigate to="/expenses/daily" replace />} />
              <Route path="expenses" element={<Navigate to="/expenses/daily" replace />} />
              <Route path="customers" element={<Customers />} />
              <Route path="suppliers" element={<Suppliers />} />
              <Route path="expenses/daily" element={<DailyExpenses />} />
              <Route
                path="expenses/monthly"
                element={
                  <AdminRoute>
                    <MonthlyExpenses />
                  </AdminRoute>
                }
              />
              <Route path="closing" element={<Closing />} />
              <Route
                path="capital"
                element={
                  <AdminRoute>
                    <Capital />
                  </AdminRoute>
                }
              />
              <Route
                path="gst"
                element={
                  <AdminRoute>
                    <Gst />
                  </AdminRoute>
                }
              />
              <Route
                path="reports"
                element={
                  <AdminRoute>
                    <Reports />
                  </AdminRoute>
                }
              />
              <Route
                path="promotions"
                element={
                  <AdminRoute>
                    <Promotions />
                  </AdminRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <AdminRoute>
                    <Settings />
                  </AdminRoute>
                }
              />
              <Route
                path="audit-log"
                element={
                  <AdminRoute>
                    <AuditLog />
                  </AdminRoute>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
