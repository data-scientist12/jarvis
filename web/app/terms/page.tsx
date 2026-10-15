import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 2026">
      <p>By using Jarvis you agree to these terms. Jarvis is a preview product provided as is.</p>

      <section>
        <h2>Using Jarvis</h2>
        <p>
          Jarvis acts on your behalf in the Google services you connect. You are responsible for the instructions you give it and for reviewing actions that need your approval.
          Turn on Autopilot only if you are comfortable with Jarvis sending email, inviting people and changing your data without asking first.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not use Jarvis to send spam, harass others, or break the law.</li>
          <li>Do not attempt to disrupt or reverse engineer the service.</li>
          <li>Follow Google&apos;s terms for any Google account you connect.</li>
        </ul>
      </section>

      <section>
        <h2>AI limitations</h2>
        <p>
          Jarvis uses AI models that can make mistakes. It verifies many actions by re-reading the result from the source and shows its evidence, but you should double-check anything
          important.
        </p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>The service may change, be rate limited, or be unavailable at times. We may update these terms; continued use means you accept the changes.</p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>To the extent permitted by law, Jarvis is provided without warranties and we are not liable for indirect or consequential losses arising from its use.</p>
      </section>
    </LegalPage>
  );
}
