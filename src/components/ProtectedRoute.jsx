import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }) {
  const { session, loading } = useAuth()

  if (loading) return <div className="loading-screen">Loading…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}
