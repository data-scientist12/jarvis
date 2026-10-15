import type { Metadata } from "next";
import { ConnectorsView } from "@/components/connectors/ConnectorsView";

export const metadata: Metadata = { title: "Connectors" };

export default function ConnectorsPage() {
  return <ConnectorsView />;
}
