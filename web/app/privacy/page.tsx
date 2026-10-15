import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 2026">
      <p>Jarvis is a personal AI agent that works inside your Google account on your behalf. This page explains what we access, why, and the choices you have.</p>

      <section>
        <h2>What Jarvis accesses</h2>
        <p>Only when you connect your Google account, and only for the apps you grant:</p>
        <ul>
          <li>Gmail: to search, read, label, draft and (with your approval) send email.</li>
          <li>Google Calendar and Meet: to read your schedule, create events and meeting links.</li>
          <li>Google Drive, Docs and Sheets: to find files and create or edit documents you ask for.</li>
          <li>Google Tasks and Contacts: to create to-dos and resolve names to email addresses.</li>
        </ul>
      </section>

      <section>
        <h2>How your data is used</h2>
        <p>
          Content from your Google account is used to carry out the requests you make and the automations you set up. Requests are processed by an AI model provider (OpenAI) to
          understand your instructions and generate responses. We do not sell your data, use it for advertising, or use it to train models.
        </p>
        <p>Jarvis&apos;s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
      </section>

      <section>
        <h2>What we store</h2>
        <ul>
          <li>Your account profile (name, email) and preferences such as time zone and autopilot.</li>
          <li>Your conversations with Jarvis, and a log of the actions it took, so you can review them in Activity.</li>
          <li>Google access and refresh tokens, encrypted at rest.</li>
          <li>Short facts you ask Jarvis to remember.</li>
        </ul>
      </section>

      <section>
        <h2>Your controls</h2>
        <ul>
          <li>Autopilot is off by default: Jarvis asks before sending email, inviting people or deleting things.</li>
          <li>You can revoke Jarvis&apos;s access at any time from your Google Account security settings.</li>
          <li>You can delete conversations at any time, and ask us to delete your account and all stored data.</li>
        </ul>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about privacy? Reach out to the person who invited you to Jarvis, or email the address listed on your account invitation.</p>
      </section>
    </LegalPage>
  );
}
