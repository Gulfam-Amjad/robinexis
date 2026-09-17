import { useEffect, useId, useRef, useState } from "react";
import { CircleDollarSign, X } from "lucide-react";
import { Button, Field } from "../../components/ui";
import { validateCreditAdjustment } from "../../lib/admin";

export function CreditAdjustmentDialog({
  customerName,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  customerName: string;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (minutes: number, reason: string) => void;
}) {
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const minutesRef = useRef<HTMLInputElement>(null);
  const validation = validateCreditAdjustment(minutes, reason);

  useEffect(() => {
    if (!open) return;
    setMinutes("");
    setReason("");
    setSubmitted(false);
    const timeout = window.setTimeout(() => minutesRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <button className="icon-button dialog-close" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
        <span className="dialog-icon"><CircleDollarSign size={22} /></span>
        <h2 id={titleId}>Adjust customer allowance</h2>
        <p id={descriptionId}>Add or remove minute allowance for {customerName}. This audited adjustment does not represent provider spend.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!validation.minutesError && !validation.reasonError) onSubmit(validation.minutes, validation.reason);
        }}>
          <Field label="Minutes" hint="Use a negative whole number to remove allowance." error={submitted ? validation.minutesError : undefined}>
            <input ref={minutesRef} inputMode="numeric" type="number" step="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-invalid={submitted && Boolean(validation.minutesError)} />
          </Field>
          <Field label="Audit reason" error={submitted ? validation.reasonError : undefined}>
            <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={submitted && Boolean(validation.reasonError)} />
          </Field>
          <div className="dialog-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record adjustment"}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
