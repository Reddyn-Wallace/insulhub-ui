export type Channel = "email" | "sms";
export type Message = { id: string; direction: "in" | "out"; text: string; time: string; via?: string; from?: string; signature?: string; quoted?: string };
export type Conversation = { id: string; channel: Channel; title: string; preview: string; time: string; unread: boolean; job: string | null; messages: Message[] };
export const sampleJobs = ["#1048 · 24 Kōwhai Road", "#0921 · 8 Rimu Street"];
export function sampleConversations(): Conversation[] {
  return [
    { id: "installation", channel: "email", title: "Ready for your installation", preview: "Thursday works perfectly. Will we need to be home?", time: "10:42 am", unread: false, job: sampleJobs[0], messages: [
      { id: "e1", direction: "out", text: "Hi Sophie,\n\nYour insulation quote is approved and we’re ready to book the installation. Would Thursday 10 September work for you?\n\nOur team would arrive between 8 and 8:30 am.", time: "Friday · 9:15 am", via: "CRM", signature: "Alex Morgan\nInsulmax · Wellington team", quoted: "No earlier messages." },
      { id: "e2", direction: "in", text: "Hi Alex,\n\nThanks for getting that organised. I’ll just check our calendar and come back to you on Monday.\n\nSophie", time: "Friday · 11:06 am", via: "Email" },
      { id: "e3", direction: "out", text: "Of course, no rush. I’ve pencilled Thursday in for you. The installation should take most of the morning.", time: "Yesterday · 2:20 pm", via: "Gmail", signature: "Alex Morgan\nInsulmax · Wellington team", quoted: "On Friday, Sophie wrote:\nThanks for getting that organised. I’ll just check our calendar…" },
      { id: "e4", direction: "in", text: "Thursday works perfectly, thank you!\n\nWill we need to be home the whole time, or can we leave a key with the neighbour? We have a school run around 8:30.\n\nThanks,\nSophie", time: "Today · 10:42 am", via: "Email", quoted: "On Sunday, Alex wrote:\nOf course, no rush. I’ve pencilled Thursday in for you…" },
    ] },
    { id: "texts", channel: "sms", title: "Texts with Sophie", preview: "The side gate will be unlocked 👍", time: "10:18 am", unread: true, job: sampleJobs[0], messages: [
      { id: "s1", direction: "out", text: "Hi Sophie, it’s Alex from Insulmax. Just checking there’s access down the side of the house for our team on Thursday?", time: "9:54 am", via: "CRM" },
      { id: "s2", direction: "in", text: "Hi Alex! Yes, there’s a gate on the left of the garage.", time: "10:02 am" },
      { id: "s3", direction: "out", text: "Perfect, thanks. We’ll keep the driveway clear for the school run.", time: "10:05 am", via: "Phone" },
      { id: "s4", direction: "in", text: "The side gate will be unlocked 👍", time: "10:18 am" },
    ] },
    { id: "assignment", channel: "email", title: "A quick question about the garage", preview: "Could you include the garage in the quote as well?", time: "Yesterday", unread: true, job: null, messages: [
      { id: "a1", direction: "in", text: "Hi Alex,\n\nCould you include the garage in the quote as well? Happy to send a couple of photos if that helps.\n\nThanks,\nSophie", time: "Yesterday · 4:12 pm", via: "Email" },
    ] },
    { id: "quote", channel: "email", title: "Your insulation quote", preview: "Looks good to us. Let’s go ahead!", time: "4 Sep", unread: false, job: sampleJobs[0], messages: [
      { id: "q1", direction: "out", text: "Hi Sophie,\n\nThanks for showing me around yesterday. The quote for your wall insulation is $4,850 including GST. This includes the installation and making good the access holes.\n\nLet me know if you have any questions.", time: "3 Sep · 3:30 pm", via: "CRM", signature: "Alex Morgan\nInsulmax · Wellington team" },
      { id: "q2", direction: "in", text: "Looks good to us. Let’s go ahead!\n\nThanks for explaining everything so clearly when you visited.", time: "4 Sep · 9:05 am", via: "Email" },
    ] },
  ];
}
