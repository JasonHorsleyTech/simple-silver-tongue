import { MessagesSquare } from "lucide-react";

/**
 * The sidebar's conversation list. For now an empty state: T02 fills it from conversation.list, adds
 * "New conversation", and links each row to /c/<id>.
 */
export function ConversationList() {
  return (
    <section>
      <h2 className="px-2 pb-2 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">Conversations</h2>
      <div className="rounded-lg border border-dashed border-line px-3 py-7 text-center">
        <MessagesSquare aria-hidden className="mx-auto size-5 text-faint" />
        <p className="mt-2 text-[13px] text-muted">No conversations yet</p>
      </div>
    </section>
  );
}
