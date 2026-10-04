'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
export default function FollowupModal({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);const heading=useId();
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-900/40"><h2 id={heading} className="mb-4 text-xl font-semibold text-[#1a3a4a]">{title}</h2>{children}</dialog>;
}
