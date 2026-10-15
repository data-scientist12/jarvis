import type { Metadata } from "next";
import { RunDetailView } from "@/components/activity/RunDetailView";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetailView id={id} />;
}
