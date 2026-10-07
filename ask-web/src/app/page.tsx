import { AppShell } from "@/components/app-shell";
import { AskFredaChat } from "@/components/ask-freda-chat";
import { readSession } from "@/lib/freda/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { data } = await readSession();
  return (
    <AppShell>
      <AskFredaChat session={data} />
    </AppShell>
  );
}
