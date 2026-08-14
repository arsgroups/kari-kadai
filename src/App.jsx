import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Sales from './pages/Sales'
import Purchases from './pages/Purchases'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import DailyExpenses from './pages/DailyExpenses'
import MonthlyExpenses from './pages/MonthlyExpenses'
import Closing from './pages/Closing'
import Gst from './pages/Gst'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import Promotions from './pages/Promotions'
import AuditLog from './pages/AuditLog'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
            <Route path="purchases" element={<Purchases />} />
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
      </AuthProvider>
    </BrowserRouter>
  )
}
