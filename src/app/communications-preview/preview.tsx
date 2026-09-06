"use client";
import { useEffect, useRef, useState } from "react";
import { sampleConversations, sampleJobs, type Channel, type Message } from "./sample-data";
import "./preview.css";

function Icon({ name, size = 18 }: { name: "email" | "sms" | "search" | "send" | "back" | "check" | "home" | "reset"; size?: number }) {
  const paths = { email: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>, sms: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5A8.5 8.5 0 0 1 11.5 3h1a8.5 8.5 0 0 1 8.5 8.5ZM7 9h10M7 13h6"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>, send: <><path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/></>, back: <path d="m14 5-7 7 7 7M7 12h14"/>, check: <path d="m4 12 5 5L20 6"/>, home: <><path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/></>, reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></> };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function EmailMessage({ message, latest }: { message: Message; latest: boolean }) {
  const name = message.direction === "in" ? "Sophie Turner" : "Alex Morgan";
  return <details className="cp-email" open={latest || undefined}>
    <summary><span className={`cp-avatar ${message.direction === "out" ? "cp-avatar-team" : ""}`}>{message.direction === "in" ? "ST" : "AM"}</span><span className="cp-email-meta"><strong>{name}<span>{message.direction === "out" ? `via ${message.via}` : "to Wellington team"}</span></strong><span className="cp-email-snippet">{message.text.replace(/\n/g, " ")}</span></span><time>{message.time}</time><span className="cp-chevron">⌄</span></summary>
    <div className="cp-email-body"><div className="cp-mail-address">{message.direction === "out" ? `${message.from || "team@example.test"} → sophie@example.test` : "sophie@example.test → team@example.test"}</div><p>{message.text}</p>{(message.signature || message.quoted) && <details className="cp-quoted"><summary>Show {message.signature && message.quoted ? "signature & quoted text" : message.signature ? "signature" : "quoted text"}</summary>{message.signature && <p>{message.signature}</p>}{message.quoted && <blockquote>{message.quoted}</blockquote>}</details>}</div>
  </details>;
}
export default function ConversationPreview() {
  const [conversations, setConversations] = useState(sampleConversations);
  const [selectedId, setSelectedId] = useState("installation");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | Channel>("all");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [senders, setSenders] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);
  const selected = conversations.find(item => item.id === selectedId)!;
  const unread = conversations.filter(item => item.unread).length;
  const matches = conversations.filter(item => (filter === "all" || filter === item.channel) && `${item.title} ${item.preview} Sophie Turner ${item.job || ""} ${item.messages.map(message => message.text).join(" ")}`.toLowerCase().includes(search.toLowerCase().trim()));
  useEffect(() => { scrollArea.current?.scrollTo?.({ top: scrollArea.current.scrollHeight, behavior: "instant" }); }, [selectedId, selected.messages.length, mobileOpen]);
  function select(id: string) {
    setSelectedId(id); setMobileOpen(true); setAssigning(false); setNotice("");
    setConversations(current => current.map(item => item.id === id ? { ...item, unread: false } : item));
  }
  function assign(job: string) {
    setConversations(current => current.map(item => item.id === selectedId ? { ...item, job } : item));
    setAssigning(false); setNotice(`Demo conversation assigned to ${job}.`);
  }
  function send(event: React.FormEvent) {
    event.preventDefault(); const text = (drafts[selectedId] || "").trim(); if (!text || !selected.job) return;
    const reply: Message = { id: crypto.randomUUID(), direction: "out", text, time: "Just now", via: "CRM", ...(selected.channel === "email" ? { from: senders[selectedId] === "alex" ? "alex@example.test" : "team@example.test", signature: "Alex Morgan\nInsulmax · Wellington team" } : { from: senders[selectedId] === "alex" ? "Alex’s mobile" : "Business mobile" }) };
    // This preview intentionally has no transport, API calls or persistent storage.
    setConversations(current => [{ ...current.find(item => item.id === selectedId)!, messages: [...selected.messages, reply], preview: text, time: "Just now", unread: false }, ...current.filter(item => item.id !== selectedId)]);
    setDrafts(current => ({ ...current, [selectedId]: "" })); setNotice("Demo reply added. Nothing was sent.");
  }
  function reset() { setConversations(sampleConversations()); setSelectedId("installation"); setDrafts({}); setSenders({}); setFilter("all"); setSearch(""); setMobileOpen(false); setAssigning(false); setNotice("Preview reset."); }
  return <main className={`cp-shell ${mobileOpen ? "cp-mobile-open" : ""}`}>
    <header className="cp-topbar"><a className="cp-brand" href="/jobs">INSUL<span>HUB</span></a><span className="cp-top-divider"/><span className="cp-workspace-label">Your workspace</span><span className="cp-demo"><span/>Interactive preview · sample data</span><button className="cp-reset" aria-label="Reset demo" onClick={reset} title="Reset sample conversations"><Icon name="reset"/><span>Reset demo</span></button></header>
    <section className="cp-context"><div><p className="cp-eyebrow">JOB #1048 <span> / </span> SOPHIE TURNER</p><h1>Communications<span className="cp-title-dot">.</span></h1><p className="cp-address"><Icon name="home" size={14}/>24 Kōwhai Road, Wellington <span className="cp-job-state">Installation booked</span></p></div><p className="cp-context-note">One conversation. Wherever you reply.<span>Explore the layout. No real messages are sent.</span></p></section>
    <div className="cp-workspace">
      <aside className="cp-sidebar" aria-label="Conversations">
        <div className="cp-sidebar-top"><div className="cp-list-heading"><h2>Conversations <span>{conversations.length}</span></h2><span className="cp-unread-count">{unread} unread</span></div><label className="cp-search"><Icon name="search" size={17}/><input aria-label="Search conversations" placeholder="Search conversations" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button aria-label="Clear search" onClick={() => setSearch("")}>×</button>}</label><div className="cp-filters" aria-label="Filter conversations">{(["all", "email", "sms"] as const).map(channel => <button key={channel} aria-pressed={filter === channel} onClick={() => setFilter(channel)}>{channel !== "all" && <Icon name={channel} size={15}/>} {channel === "all" ? "All messages" : channel === "email" ? "Email" : "SMS"}</button>)}</div></div>
        <div className="cp-list">{matches.length ? matches.map(item => <button key={item.id} className={`cp-thread ${selectedId === item.id ? "cp-thread-active" : ""}`} onClick={() => select(item.id)} aria-current={selectedId === item.id ? "true" : undefined}>
          <div className="cp-thread-top"><span className={`cp-channel cp-channel-${item.channel}`}><Icon name={item.channel} size={14}/>{item.channel === "email" ? "EMAIL" : "SMS"}</span><time>{item.time}</time>{item.unread && <span className="cp-unread-dot" aria-label="Unread"/>}</div><h3>{item.title}</h3><p>{item.preview}</p>{!item.job && <span className="cp-needs-job">Choose job <span>2 matches</span></span>}
        </button>) : <div className="cp-no-results"><Icon name="search" size={25}/><h3>No conversations found</h3><p>Try another name, address or word from a message.</p><button onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button></div>}</div>
        <div className="cp-sidebar-foot"><span className="cp-avatar cp-avatar-small">ST</span><div><strong>Sophie Turner</strong><span>Sample contact · email & mobile</span></div></div>
      </aside>
      <section className="cp-conversation" aria-label="Selected conversation">
        <header className="cp-conversation-header"><button className="cp-back" aria-label="Back to conversations" onClick={() => setMobileOpen(false)}><Icon name="back"/></button><div className="cp-conversation-title"><div className="cp-thread-kicker"><Icon name={selected.channel} size={14}/>{selected.channel === "email" ? "EMAIL CONVERSATION" : "TEXT CONVERSATION"}<span className="cp-mobile-demo">DEMO</span></div><h2>{selected.title}</h2><p>{selected.channel === "email" ? "Sophie Turner · sophie@example.test" : "Sophie Turner · sample mobile"}</p></div><button className="cp-mark-unread" onClick={() => { setConversations(current => current.map(item => item.id === selectedId ? { ...item, unread: !item.unread } : item)); }} aria-label={selected.unread ? "Mark as read" : "Mark as unread"}><Icon name={selected.unread ? "check" : "email"}/><span>{selected.unread ? "Mark read" : "Mark unread"}</span></button></header>
        <div className={`cp-job-link ${!selected.job ? "cp-job-unassigned" : ""}`}><Icon name="home" size={15}/><span>{selected.job || "This contact has two matching jobs"}</span><button onClick={() => setAssigning(!assigning)} aria-expanded={assigning}>{selected.job ? "Change" : "Choose job"}</button></div>
        {assigning && <div className="cp-assignment"><strong>Which job is this conversation about?</strong><p>Choose a property. This changes the demo only.</p>{sampleJobs.map(job => <button key={job} onClick={() => assign(job)}><Icon name="home" size={16}/>{job}{selected.job === job && <Icon name="check" size={16}/>}</button>)}<button onClick={() => assign("Both jobs · #1048 + #0921")}><Icon name="check" size={16}/>Both jobs</button></div>}
        <div className={`cp-messages cp-messages-${selected.channel}`} ref={scrollArea}>
          <div className="cp-day-divider"><span>{selected.channel === "sms" ? "Today" : "Start of conversation"}</span></div>
          {selected.channel === "email" ? selected.messages.map((message, index) => <EmailMessage key={message.id} message={message} latest={index >= selected.messages.length - 2}/>) : selected.messages.map(message => <div className={`cp-sms-row cp-sms-${message.direction}`} key={message.id}><div className="cp-bubble">{message.text}</div><div className="cp-sms-meta">{message.time}{message.direction === "out" && <><span>· {message.via}{message.from ? ` · ${message.from}` : ""}</span><Icon name="check" size={12}/></>}</div></div>)}
          {!selected.job && <p className="cp-assignment-hint">Choose a job above before replying.</p>}
        </div>
        <form className="cp-compose" onSubmit={send}>
          <div className="cp-reply-label"><span>Reply to <strong>Sophie</strong></span><label>From <select aria-label="Sending account" value={senders[selectedId] || "team"} onChange={event => setSenders(current => ({ ...current, [selectedId]: event.target.value }))}>{selected.channel === "email" ? <><option value="team">Wellington team · team@example.test</option><option value="alex">Alex · alex@example.test</option></> : <><option value="team">Business mobile · demo</option><option value="alex">Alex’s mobile · demo</option></>}</select></label></div>
          <textarea aria-label="Reply message" placeholder={selected.job ? selected.channel === "email" ? "Write your reply…" : "Write a text…" : "Choose a job to reply…"} value={drafts[selectedId] || ""} onChange={event => setDrafts(current => ({ ...current, [selectedId]: event.target.value }))} disabled={!selected.job} rows={selected.channel === "sms" ? 2 : 3}/>
          <div className="cp-compose-bottom"><span>{selected.channel === "email" ? "Signature added automatically" : `${(drafts[selectedId] || "").length} characters`}</span><button type="submit" disabled={!selected.job || !(drafts[selectedId] || "").trim()}>Send demo reply<Icon name="send" size={16}/></button></div>
          <p className="cp-notice" role="status">{notice || "Demo only. Replies stay on this page."}</p>
        </form>
      </section>
    </div>
  </main>;
}
