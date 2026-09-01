import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDate } from '../lib/format'
import UserRolesPanel from './settings/UserRolesPanel'
import HistoricalDataEntryPanel from './settings/HistoricalDataEntryPanel'
import PartnerFeeSettingsPanel from './settings/PartnerFeeSettingsPanel'

// supabase-js's functions.invoke() collapses a non-2xx response into a generic
// "Edge Function returned a non-2xx status code" message — the actual error
// detail our function sent back is on error.context (the raw Response).
async function extractFunctionError(error, data) {
  if (data?.error) return data.error
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json()
      if (body?.error) return body.error
    } catch {
      // response wasn't JSON — fall through to the generic message below
    }
  }
  return error?.message || 'Request failed.'
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [runningNow, setRunningNow] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [branding, setBranding] = useState(null)
  const [uploadingHeader, setUploadingHeader] = useState(false)
  const [uploadingFooter, setUploadingFooter] = useState(false)
  const [brandingError, setBrandingError] = useState('')

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: l }, { data: b }] = await Promise.all([
      supabase.from('backup_settings').select('*').single(),
      supabase.from('backup_logs').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('branding_settings').select('*').single(),
    ])
    setSettings(s)
    setLogs(l ?? [])
    setBranding(b)
    setLoading(false)
  }

  async function handleImageUpload(slot, file) {
    if (!file) return
    const setUploading = slot === 'header' ? setUploadingHeader : setUploadingFooter
    setUploading(true)
    setBrandingError('')
    const ext = file.name.split('.').pop()
    const path = `${slot}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('branding')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      setUploading(false)
      setBrandingError(uploadError.message)
      return
    }
    const { data: urlData } = supabase.storage.from('branding').getPublicUrl(path)
    const column = slot === 'header' ? 'header_image_url' : 'footer_image_url'
    const { error: updateError } = await supabase
      .from('branding_settings')
      .update({ [column]: urlData.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', branding.id)
    setUploading(false)
    if (updateError) {
      setBrandingError(updateError.message)
      return
    }
    load()
  }

  async function handleImageReset(slot) {
    const column = slot === 'header' ? 'header_image_url' : 'footer_image_url'
    setBrandingError('')
    const { error: updateError } = await supabase
      .from('branding_settings')
      .update({ [column]: null, updated_at: new Date().toISOString() })
      .eq('id', branding.id)
    if (updateError) {
      setBrandingError(updateError.message)
      return
    }
    load()
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    const { error } = await supabase
      .from('backup_settings')
      .update({
        enable_auto_backup: settings.enable_auto_backup,
        backup_time: settings.backup_time,
        drive_folder_id: settings.drive_folder_id || null,
        keep_local_backup_days: Number(settings.keep_local_backup_days) || 30,
        retention_policy: settings.retention_policy || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess('Settings saved.')
  }

  async function handleTestConnection() {
    setTesting(true)
    setError('')
    setSuccess('')
    const { data, error } = await supabase.functions.invoke('daily-backup', { body: { dryRun: true } })
    setTesting(false)
    if (error || data?.ok === false) {
      setError(await extractFunctionError(error, data))
      return
    }
    setSuccess(data?.message || 'Connected to Google Drive successfully.')
  }

  async function handleRunNow() {
    setRunningNow(true)
    setError('')
    setSuccess('')
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase.functions.invoke('daily-backup', { body: { date: today } })
    setRunningNow(false)
    if (error || data?.ok === false) {
      setError(await extractFunctionError(error, data))
      load()
      return
    }
    setSuccess('Backup completed and uploaded to Google Drive.')
    load()
  }

  if (loading || !settings || !branding) return <p className="muted">Loading…</p>

  return (
    <div className="page">
      <h1>Settings</h1>

      <UserRolesPanel />

      <HistoricalDataEntryPanel />

      <PartnerFeeSettingsPanel />

      <div className="card">
        <h3>Invoice Branding</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Upload images to replace the banner shown at the top (and optionally bottom) of printed Sale
          Invoices. Leave unset to use the default header and no footer image.
        </p>
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div>
            <strong>Header Image</strong>
            <div style={{ margin: '0.5rem 0' }}>
              {branding.header_image_url ? (
                <img
                  src={branding.header_image_url}
                  alt="Invoice header"
                  style={{ maxWidth: 280, display: 'block', borderRadius: 6 }}
                />
              ) : (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  Using the default bundled header.
                </p>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              disabled={uploadingHeader}
              onChange={(e) => handleImageUpload('header', e.target.files?.[0])}
            />
            {uploadingHeader && <p className="muted">Uploading…</p>}
            {branding.header_image_url && (
              <button type="button" className="btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => handleImageReset('header')}>
                Reset to Default
              </button>
            )}
          </div>
          <div>
            <strong>Footer Image (optional)</strong>
            <div style={{ margin: '0.5rem 0' }}>
              {branding.footer_image_url ? (
                <img
                  src={branding.footer_image_url}
                  alt="Invoice footer"
                  style={{ maxWidth: 280, display: 'block', borderRadius: 6 }}
                />
              ) : (
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  No footer image set.
                </p>
              )}
            </div>
            <input
              type="file"
              accept="image/*"
              disabled={uploadingFooter}
              onChange={(e) => handleImageUpload('footer', e.target.files?.[0])}
            />
            {uploadingFooter && <p className="muted">Uploading…</p>}
            {branding.footer_image_url && (
              <button type="button" className="btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => handleImageReset('footer')}>
                Remove
              </button>
            )}
          </div>
        </div>
        {brandingError && <div className="inline-error">{brandingError}</div>}
      </div>

      <div className="card">
        <h3>Backup Settings</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Requires one-time setup on your end first — a Google Cloud service account and a deployed
          backup function. Ask me for the walkthrough if you haven't done that yet.
        </p>
        <form className="form-grid" onSubmit={handleSave}>
          <label>
            <span style={{ display: 'block', marginBottom: '0.3rem' }}>Enable Auto Backup</span>
            <select
              value={settings.enable_auto_backup ? 'yes' : 'no'}
              onChange={(e) => setSettings({ ...settings, enable_auto_backup: e.target.value === 'yes' })}
            >
              <option value="no">Off</option>
              <option value="yes">On (triggers when Daily Closing is saved)</option>
            </select>
          </label>
          <label>
            Backup Time (reserved for future scheduled backups)
            <input
              type="time"
              value={settings.backup_time?.slice(0, 5) ?? '23:30'}
              onChange={(e) => setSettings({ ...settings, backup_time: e.target.value })}
            />
          </label>
          <label>
            Google Drive Folder ID
            <input
              value={settings.drive_folder_id ?? ''}
              onChange={(e) => setSettings({ ...settings, drive_folder_id: e.target.value })}
              placeholder="From the Drive folder's URL"
            />
          </label>
          <label>
            Keep Local Backup (Days)
            <input
              type="number"
              step="1"
              value={settings.keep_local_backup_days}
              onChange={(e) => setSettings({ ...settings, keep_local_backup_days: e.target.value })}
            />
          </label>
          <label>
            Backup Retention Policy
            <input
              value={settings.retention_policy ?? ''}
              onChange={(e) => setSettings({ ...settings, retention_policy: e.target.value })}
            />
          </label>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </form>

        <div className="toolbar" style={{ marginTop: '1rem' }}>
          <button className="btn-secondary" onClick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button className="btn-secondary" onClick={handleRunNow} disabled={runningNow}>
            {runningNow ? 'Running…' : 'Run Backup Now'}
          </button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        {success && <div style={{ color: 'var(--success)', marginTop: '0.5rem' }}>{success}</div>}
      </div>

      <div className="card">
        <h3>Recent Backups</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Files</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{formatDate(l.date)}</td>
                <td>
                  <span
                    className={
                      l.status === 'success' ? 'tag tag-success' : l.status === 'failed' ? 'tag tag-danger' : 'tag tag-muted'
                    }
                  >
                    {l.status}
                  </span>
                </td>
                <td>{Array.isArray(l.files) ? l.files.map((f) => f.name).join(', ') : ''}</td>
                <td>{l.error}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No backups run yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
