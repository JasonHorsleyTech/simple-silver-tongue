import { ChatView } from "../features/chat/ChatView.tsx";
import { NewConversationView } from "../features/conversations/NewConversationView.tsx";
import { NotFoundView } from "../features/home/NotFoundView.tsx";
import { matchPath, usePath } from "../lib/router.tsx";

/** URL → view, rendered in the shell's main area. Add a line per view, most specific first. */
export function Routes() {
  const path = usePath();
  if (path === "/") return <NewConversationView />;
  const c = matchPath("/c/:id", path);
  if (c) return <ChatView key={c.id} id={c.id} />;
  return <NotFoundView />;
}
