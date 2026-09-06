import type { Metadata } from "next";
import ConversationPreview from "./preview";
export const metadata: Metadata = { title: "Communications preview · InsulHub", robots: { index: false, follow: false } };
export default function Page() { return <ConversationPreview />; }
