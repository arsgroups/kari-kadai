import { useEffect, useRef, useState } from 'react'

// A text-input + filtered dropdown, for picking one option out of a long
// list without scrolling a native <select>. `options` is [{ value, label }].
export default function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled, style }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  const selected = options.find((o) => o.value === value)
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function pick(optionValue) {
    onChange(optionValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 160, ...style }}>
      <input
        type="text"
        disabled={disabled}
        value={open ? query : (selected?.label ?? '')}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
            e.currentTarget.blur()
          }
        }}
        style={{
          width: '100%',
          padding: '0.4rem 0.5rem',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: '0.9rem',
          fontFamily: 'inherit',
          background: disabled ? 'var(--bg)' : 'var(--surface)',
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginTop: 2,
            maxHeight: 220,
            overflowY: 'auto',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
          }}
        >
          {filtered.length === 0 && (
            <div style={{ padding: '0.5rem 0.6rem', fontSize: '0.85rem', color: 'var(--muted)' }}>No matches</div>
          )}
          {filtered.map((o) => (
            <div
              key={o.value}
              onClick={() => pick(o.value)}
              style={{
                padding: '0.45rem 0.6rem',
                cursor: 'pointer',
                fontSize: '0.88rem',
                background: o.value === value ? 'var(--bg)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = o.value === value ? 'var(--bg)' : 'transparent'
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
