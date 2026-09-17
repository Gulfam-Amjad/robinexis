import type { LucideIcon } from "lucide-react";
import { AlertCircle, ArrowRight, Inbox, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button className={`button button-${variant} button-${size} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return <span className={`badge badge-${tone}`} role="status">{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "cream",
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon: LucideIcon;
  tone?: "cream" | "peach" | "sage" | "lilac";
}) {
  return (
    <Card className={`metric-card metric-${tone}`}>
      <div className="metric-icon"><Icon size={19} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </Card>
  );
}

export function LoadingState({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={28} />
      <strong>{label}</strong>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="state-panel state-error" role="alert">
      <AlertCircle size={28} />
      <strong>We couldn’t load this</strong>
      <p>{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}><RefreshCw size={15} /> Try again</Button>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-empty">
      <div className="empty-icon"><Icon size={24} /></div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {action}
    </div>
  );
}

export function LinkButton({ to, children, variant = "primary" }: { to: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return <Link className={`button button-${variant} button-md`} to={to}>{children}<ArrowRight size={15} /></Link>;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-list">{Array.from({ length: count }, (_, index) => <div className="skeleton-row" key={index} />)}</div>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = useId();
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <small id={hintId} className="field-error" role="alert">{error}</small> : hint ? <small id={hintId}>{hint}</small> : null}
    </label>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <button className="icon-button dialog-close" type="button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
        <span className="dialog-icon"><AlertCircle size={22} /></span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant={tone} type="button" onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}

export function statusTone(status?: string): "neutral" | "success" | "warning" | "danger" | "accent" {
  if (["active", "completed", "ready", "connected", "trialing", "approved"].includes(status || "")) return "success";
  if (["pending", "indexing", "dialing", "past_due"].includes(status || "")) return "warning";
  if (["failed", "canceled", "cancelled", "unpaid", "suppressed"].includes(status || "")) return "danger";
  return "neutral";
}
