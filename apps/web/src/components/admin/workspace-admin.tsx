import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, X } from "lucide-react";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useToast } from "../../state";
import { Button, Field } from "../ui";

export type WorkspaceTarget = { id: string; businessName: string; slug: string };

const SLUG_PATTERN = /^[a-z0-9-]{2,80}$/;

function workspaceAdminError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  if (message === "slug_taken") return "That workspace slug is already in use.";
  if (message === "valid_business_name_and_slug_required") return "Use a business name of at least 2 characters and a slug of lowercase letters, numbers, and hyphens.";
  if (message === "confirmation_mismatch") return "Type the business name exactly to confirm.";
  if (message === "platform_admin_required") return "Only an operator can change workspaces.";
  if (message === "protected_workspace_delete_forbidden") return "This protected production workspace cannot be deleted.";
  if (message === "active_subscription_must_be_cancelled") return "Cancel the customer’s active subscription before deleting this workspace.";
  if (message === "provisioning_in_progress") return "Wait for provisioning to finish or cancel it before deleting this workspace.";
  return message;
}

function useWorkspaceAdminState() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState<WorkspaceTarget>();
  const [deleting, setDeleting] = useState<WorkspaceTarget>();
  const update = useMutation({
    mutationFn: (values: { id: string; businessName: string; slug: string }) =>
      api.updateWorkspace(values.id, { businessName: values.businessName, slug: values.slug }),
    onSuccess: async (_client, values) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
        queryClient.invalidateQueries({ queryKey: ["client", values.id] }),
      ]);
      setEditing(undefined);
      push({ title: "Workspace updated", message: values.businessName, tone: "success" });
    },
    onError: (error) => push({ title: "Couldn’t update workspace", message: workspaceAdminError(error), tone: "error" }),
  });
  const remove = useMutation({
    mutationFn: ({ id, confirmation }: { id: string; confirmation: string }) => api.deleteClient(id, confirmation),
    onSuccess: async (_result, values) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
        queryClient.invalidateQueries({ queryKey: ["client", values.id] }),
      ]);
      setDeleting(undefined);
      push({ title: "Workspace removed", message: "Platform records for this customer were deleted.", tone: "success" });
      if (location.pathname.startsWith(`/admin/customers/${values.id}`)) navigate("/admin/customers");
    },
    onError: (error) => push({ title: "Couldn’t remove workspace", message: workspaceAdminError(error), tone: "error" }),
  });
  return {
    editing,
    deleting,
    openEdit: setEditing,
    openDelete: setDeleting,
    closeEdit: () => { if (!update.isPending) setEditing(undefined); },
    closeDelete: () => { if (!remove.isPending) setDeleting(undefined); },
    update,
    remove,
  };
}

type WorkspaceAdminState = ReturnType<typeof useWorkspaceAdminState>;
const WorkspaceAdminContext = createContext<WorkspaceAdminState | undefined>(undefined);

export function WorkspaceAdminProvider({ children }: { children: ReactNode }) {
  const admin = useWorkspaceAdminState();
  return <WorkspaceAdminContext.Provider value={admin}>
    {children}
    <WorkspaceAdminDialogs admin={admin} />
  </WorkspaceAdminContext.Provider>;
}

export function useWorkspaceAdmin() {
  const admin = useContext(WorkspaceAdminContext);
  if (!admin) throw new Error("WorkspaceAdminProvider is required");
  return admin;
}

function WorkspaceAdminDialogs({ admin }: { admin: WorkspaceAdminState }) {
  return <>
    <WorkspaceEditDialog
      workspace={admin.editing}
      busy={admin.update.isPending}
      onClose={admin.closeEdit}
      onSubmit={(businessName, slug) => {
        if (!admin.editing) return;
        admin.update.mutate({ id: admin.editing.id, businessName, slug });
      }}
    />
    <WorkspaceDeleteDialog
      workspace={admin.deleting}
      busy={admin.remove.isPending}
      onClose={admin.closeDelete}
      onSubmit={(confirmation) => {
        if (!admin.deleting) return;
        admin.remove.mutate({ id: admin.deleting.id, confirmation });
      }}
    />
  </>;
}

function WorkspaceEditDialog({
  workspace,
  busy,
  onClose,
  onSubmit,
}: {
  workspace?: WorkspaceTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (businessName: string, slug: string) => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const titleId = useId();
  useEffect(() => {
    setBusinessName(workspace?.businessName || "");
    setSlug(workspace?.slug || "");
    setSubmitted(false);
  }, [workspace?.id, workspace?.businessName, workspace?.slug]);
  useEffect(() => {
    if (!workspace) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, workspace]);
  if (!workspace) return null;
  const nameError = businessName.trim().length < 2 ? "Business name must be at least 2 characters" : undefined;
  const slugError = SLUG_PATTERN.test(slug.trim()) ? undefined : "Use 2–80 lowercase letters, numbers, and hyphens";
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button className="icon-button dialog-close" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
      <span className="dialog-icon"><Pencil size={22} /></span>
      <h2 id={titleId}>Edit workspace</h2>
      <p>Update the name and slug shown in the workspace list. This applies immediately for {workspace.businessName}.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!nameError && !slugError) onSubmit(businessName.trim(), slug.trim());
      }}>
        <Field label="Business name" error={submitted ? nameError : undefined}>
          <input autoFocus value={businessName} onChange={(event) => setBusinessName(event.target.value)} />
        </Field>
        <Field label="Workspace slug" error={submitted ? slugError : undefined}>
          <input value={slug} onChange={(event) => setSlug(event.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy}>{busy ? "Saving…" : "Save workspace"}</Button>
        </div>
      </form>
    </section>
  </div>;
}

function WorkspaceDeleteDialog({
  workspace,
  busy,
  onClose,
  onSubmit,
}: {
  workspace?: WorkspaceTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (confirmation: string) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    setConfirmation("");
    setSubmitted(false);
  }, [workspace?.id]);
  useEffect(() => {
    if (!workspace) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, workspace]);
  if (!workspace) return null;
  const confirmationError = confirmation === workspace.businessName ? undefined : `Type ${workspace.businessName} to confirm`;
  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <button className="icon-button dialog-close" type="button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
      <span className="dialog-icon"><Trash2 size={22} /></span>
      <h2 id={titleId}>Delete workspace</h2>
      <p id={descriptionId}>This removes {workspace.businessName} and its platform records, including calls, setup, and workspace access. Any live Twilio number or ElevenLabs agent is not released and stays until you release it separately.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (!confirmationError) onSubmit(confirmation);
      }}>
        <Field label={`Type ${workspace.businessName}`} error={submitted ? confirmationError : undefined}>
          <input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </Field>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy || Boolean(confirmationError)}>{busy ? "Deleting…" : "Delete workspace"}</Button>
        </div>
      </form>
    </section>
  </div>;
}
