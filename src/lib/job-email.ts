export type JobEmailMessage = { id: string; subject: string; body: string; renderedBody: string; renderedHtml: string; destination: string; senderLabel: string; senderValue: string; actorName: string; status: string; failureReason: string; createdAt: string };
export function validateJobEmail(input: { destination?: unknown; subject?: unknown; body?: unknown }) {
  if (typeof input.destination !== "string" || input.destination.length > 254 || !/^[^\s<>(),;:"\\]+@[^\s<>(),;:"\\]+\.[^\s<>(),;:"\\]+$/.test(input.destination.trim())) throw Error("A valid job contact email is required.");
  if (typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 200 || /[\r\n\0]/.test(input.subject)) throw Error("Enter a subject of up to 200 characters on one line.");
  if (typeof input.body !== "string" || !input.body.trim() || input.body.length > 20000 || input.body.includes("\0")) throw Error("Enter a message of up to 20,000 characters.");
  return { destination: input.destination.trim(), subject: input.subject, body: input.body };
}
export function emailStatusLabel(status: string) {
  return ({ sending: "Sending", sent: "Sent", failed: "Failed", unknown: "Send not confirmed" } as Record<string,string>)[status] || status;
}
export function emailPreviewHtml(body: string, signature = "") {
  return body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n/g, "\n").replace(/\n/g, "<br>").replace(/(<br>)*$/g, "") + (signature.trim() ? `<br><br>${signature.trim()}` : "");
}
