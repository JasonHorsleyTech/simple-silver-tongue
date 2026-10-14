import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/Button.tsx";
import { LogoMark } from "../components/Logo.tsx";
import { useSession } from "./session.tsx";

/** Shown for the few milliseconds of the first whoami. Kept blank on purpose: no flash of anything. */
export function BootScreen() {
  return <div className="h-full bg-canvas" aria-busy="true" />;
}

export function UnreachableScreen({ error }: { error: string }) {
  const { retry } = useSession();
  const [pending, setPending] = useState(false);
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <LogoMark size={40} className="mx-auto" />
        <h1 className="mt-5 text-lg font-semibold">Can't load simple silver</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{error}</p>
        <Button
          className="mt-6"
          loading={pending}
          onClick={() => {
            setPending(true);
            retry();
          }}
        >
          {!pending && <RotateCw aria-hidden className="size-4" />}
          Try again
        </Button>
      </div>
    </div>
  );
}
