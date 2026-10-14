import { Link } from "../../lib/router.tsx";

/** Unknown paths. ("/" is the new-conversation view, in features/conversations.) */
export function NotFoundView() {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-16 text-center">
      <div>
        <h1 className="text-lg font-semibold">Nothing here</h1>
        <p className="mt-2 text-sm text-muted">This page doesn't exist.</p>
        <Link to="/" className="mt-5 inline-block text-sm text-silver underline decoration-line-strong underline-offset-4 hover:decoration-silver">
          Back to the start
        </Link>
      </div>
    </div>
  );
}
