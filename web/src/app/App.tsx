import { Toaster } from "../components/toasts.tsx";
import { LoginScreen } from "../features/auth/LoginScreen.tsx";
import { AppShell } from "../features/shell/AppShell.tsx";
import { BootScreen, UnreachableScreen } from "./BootScreens.tsx";
import { SessionProvider, useSession } from "./session.tsx";

export function App() {
  return (
    <SessionProvider>
      <Root />
      <Toaster />
    </SessionProvider>
  );
}

function Root() {
  const { state } = useSession();
  switch (state.phase) {
    case "booting":
      return <BootScreen />;
    case "unreachable":
      return <UnreachableScreen error={state.error} />;
    case "out":
      return <LoginScreen notice={state.notice} />;
    case "in":
      return <AppShell user={state.user} />;
  }
}
