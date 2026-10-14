import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ModelInfo } from "../../api/types.ts";

/**
 * Venice's models (models.list, cached ~10 min on the server, and once per page here, per type). The text list
 * says what a model can do (reasoning, effort levels) and feeds the text model picker; the image list feeds
 * the image model picker.
 */
const cached: Partial<Record<ModelInfo["type"], Promise<ModelInfo[]>>> = {};

export function useModels(type: ModelInfo["type"]): { models: ModelInfo[] | null; error: string | null } {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const p = (cached[type] ??= api.call("models.list", { type }).then((r) => r.models));
    p.then(
      (m) => live && setModels(m),
      (err) => {
        delete cached[type]; // try again next time
        if (live) setError(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, [type]);
  return { models, error };
}
