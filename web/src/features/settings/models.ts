import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ModelInfo } from "../../api/types.ts";

/**
 * Venice's text models (models.list, cached ~10 min on the server, and once per page here). The settings
 * use them for what a model can do: reasoning, and which effort levels. T04's model pickers read the same list.
 */
let cached: Promise<ModelInfo[]> | null = null;

export function useTextModels(): { models: ModelInfo[] | null; error: string | null } {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= api.call("models.list", { type: "text" }).then((r) => r.models);
    cached.then(
      (m) => live && setModels(m),
      (err) => {
        cached = null; // try again next time
        if (live) setError(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return { models, error };
}
