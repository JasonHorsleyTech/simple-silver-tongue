import { useEffect, useState } from "react";
import { api } from "../../api/client.ts";
import { errorMessage } from "../../api/errors.ts";
import type { ExampleInfo, PresetInfo } from "../../api/types.ts";

type List<T> = { items: T[] | null; error: string | null };

/**
 * The committed library (T07 examples, T10 presets): examples.list and presets.list, no login needed. Read
 * afresh each time a view mounts, so a file edited in the repo shows on the next visit without a reload.
 */
function useList<T>(load: () => Promise<T[]>): List<T> {
  const [state, setState] = useState<List<T>>({ items: null, error: null });
  useEffect(() => {
    let live = true;
    load().then(
      (items) => live && setState({ items, error: null }),
      (err) => live && setState({ items: null, error: errorMessage(err) }),
    );
    return () => {
      live = false;
    };
  }, []); // `load` is one fixed call per hook below
  return state;
}

export const usePresets = (): List<PresetInfo> => useList(() => api.call("presets.list").then((r) => r.presets));
export const useExamples = (): List<ExampleInfo> => useList(() => api.call("examples.list").then((r) => r.examples));
