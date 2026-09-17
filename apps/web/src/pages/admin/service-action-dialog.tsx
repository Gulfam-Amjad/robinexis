import { useEffect, useId, useState } from "react";
import { PauseCircle, X } from "lucide-react";
import { Button, Field } from "../../components/ui";
import { validateServiceAction } from "../../lib/admin";

export function ServiceActionDialog({
  customerName,
  action,
  busy,
  onClose,
  onSubmit,
}: {
  customerName: string;
  action?: "suspend" | "reactivate";
  busy: boolean;
  onClose: () => void;
  onSubmit: (action: "suspend" | "reactivate", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!action) return;
    setReason("");
    setConfirmation("");
    setSubmitted(false);
  }, [action]);
  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action, busy, onClose]);
  if (!action) return null;
  const validation = validateServiceAction(reason, confirmation, customerName);
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <button className="icon-button dialog-close" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
      <span className="dialog-icon"><PauseCircle size={22} /></span>
      <h2 id={titleId}>{action === "suspend" ? "Suspend customer service" : "Reactivate customer service"}</h2>
      <p id={descriptionId}>This changes call access for {customerName}. The reason and operator identity are written to the audit log.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!validation.reasonError && !validation.confirmationError) onSubmit(action, validation.reason);
      }}>
        <Field label="Audit reason" error={submitted ? validation.reasonError : undefined}><textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <Field label={`Type ${validation.expectedConfirmation}`} error={submitted ? validation.confirmationError : undefined}><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
        <div className="dialog-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy}>{busy ? "Saving…" : action === "suspend" ? "Suspend service" : "Reactivate service"}</Button></div>
      </form>
    </section>
  </div>;
}
