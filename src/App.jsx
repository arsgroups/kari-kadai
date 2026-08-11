import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
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
import Import from './pages/Import'
import Settings from './pages/Settings'

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
            <Route path="expenses/monthly" element={<MonthlyExpenses />} />
            <Route path="closing" element={<Closing />} />
            <Route path="gst" element={<Gst />} />
            <Route path="reports" element={<Reports />} />
            <Route path="import" element={<Import />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
