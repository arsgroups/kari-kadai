import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function AdminRoute({ children }) {
  const { roleLoading, isAdmin } = useAuth()

  if (roleLoading) return <div className="loading-screen">Loading…</div>
  if (!isAdmin) return <Navigate to="/" replace />
  return children
}
