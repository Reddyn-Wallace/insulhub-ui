"use client";
import { AppDialog } from "./AppDialog";

export default function NoSendingAccountDialog({ open, channel, onClose, onLegacy }: {
  open: boolean; channel: "sms" | "email"; onClose: () => void; onLegacy?: () => void;
}) {
  return <AppDialog
    open={open}
    title={`No ${channel === "sms" ? "SMS" : "email"} account connected`}
    description={`Connect your ${channel === "sms" ? "SMS" : "email"} account in Settings to send from the CRM, or use Legacy Comms to open your ${channel === "sms" ? "SMS" : "email"} app.`}
    confirmLabel="Connect an account"
    cancelLabel="Use Legacy Comms"
    onConfirm={() => { window.location.assign(`/jobs/settings?section=senders&channel=${channel}`); }}
    onCancel={() => { onClose(); onLegacy?.(); }}
    onDismiss={onClose}
  />;
}
