import { HomeView, NotFoundView } from "../features/home/HomeView.tsx";
import { usePath } from "../lib/router.tsx";

/**
 * URL → view, rendered in the shell's main area. Add a line per view, most specific first, e.g. T02:
 *   const c = matchPath("/c/:id", path); if (c) return <ChatView key={c.id} id={c.id} />;
 */
export function Routes() {
  const path = usePath();
  if (path === "/") return <HomeView />;
  return <NotFoundView />;
}
