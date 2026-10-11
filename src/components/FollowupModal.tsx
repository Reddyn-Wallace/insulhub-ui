'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
export default function FollowupModal({title,onClose,busy=false,composer=false,children}:{title:string;onClose:()=>void;busy?:boolean;composer?:boolean;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);const heading=useId();
 useEffect(()=>{const element=dialog.current;const previousFocus=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previousFocus?.focus();};},[]);
 useEffect(()=>{if(!composer)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[composer]);
 const layout=composer?'m-0 h-dvh max-h-dvh w-full max-w-none rounded-none p-0 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:rounded-2xl':'m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg rounded-2xl p-6';
 return <dialog ref={dialog} aria-labelledby={heading} onCancel={event=>{event.preventDefault();event.stopPropagation();if(!busy)onClose();}} className={layout+' overflow-y-auto border border-slate-200 bg-white shadow-xl backdrop:bg-slate-900/40'}>
  {composer?<header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-200 bg-white p-5"><h2 id={heading} className="text-xl font-semibold text-[#1a3a4a]">{title}</h2><button type="button" aria-label="Close offer" disabled={busy} onClick={onClose} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold disabled:opacity-50">Close</button></header>:<h2 id={heading} className="mb-4 text-xl font-semibold text-[#1a3a4a]">{title}</h2>}
  {composer?<div className="space-y-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>:children}
 </dialog>;
}
