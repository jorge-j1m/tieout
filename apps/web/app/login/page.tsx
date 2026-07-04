import { LoginForm } from "@/components/chrome/LoginForm";
import { LoginHint } from "@/components/chrome/LoginHint";

export const metadata = { title: "Operator login" };

/**
 * Operator sign-in. Reconciliation is read-open to everyone; only the people who
 * work exceptions need an account, and the form makes that plain. The demo
 * persona reaches every page without ever landing here — unless the deployment
 * lends its visitor key (LoginHint), in which case this page hands it over.
 */
export default function LoginPage() {
  return (
    <div className="flex flex-col items-center px-6 py-20">
      <LoginForm />
      <LoginHint />
      <p className="mt-7 max-w-[360px] text-center text-[11.5px] italic text-muted">
        Tieout observes and explains. It never moves money, never edits your books, and never
        guesses.
      </p>
    </div>
  );
}
