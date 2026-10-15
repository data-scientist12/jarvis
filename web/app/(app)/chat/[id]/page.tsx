import { Suspense } from "react";
import type { Metadata } from "next";
import { ChatView } from "@/components/chat/ChatView";

export const metadata: Metadata = { title: "Chat" };

async function ChatParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView key={id} id={id} />;
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="h-full">
      <Suspense fallback={null}>
        <ChatParams params={params} />
      </Suspense>
    </div>
  );
}
