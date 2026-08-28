import type { ReactNode } from 'react'

interface DcaSectionPanelProps {
  id: string
  active: boolean
  children: ReactNode
}

interface DcaBlockProps {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

function withClassName(base: string, className?: string): string {
  return className ? `${base} ${className}` : base
}

export function DcaSectionPanel({ id, active, children }: DcaSectionPanelProps) {
  return (
    <div
      className="dca-section-panel"
      data-dca-section={id}
      style={{ display: active ? 'block' : 'none' }}
    >
      {children}
    </div>
  )
}

export function DcaBlock({ title, actions, children, className }: DcaBlockProps) {
  return (
    <section className={withClassName('dca-block', className)}>
      {(title || actions) && (
        <header className="dca-block-header">
          {title && <h3 className="dca-block-title">{title}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}
