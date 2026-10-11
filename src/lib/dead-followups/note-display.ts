// Keep the retry marker in saved notes, but omit it from the reading view.
export function displayFollowupNotes(notes:string|null|undefined){
 return (notes||'').replace(/^\[Dead quote follow-up [a-f\d-]{36}\]\r?\n/gim,'');
}
