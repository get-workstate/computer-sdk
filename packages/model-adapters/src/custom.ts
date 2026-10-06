import type { CuaAdapter } from "@workstate/sdk";

export function createCustomAdapter(options: {
  name: string;
  description?: string;
  available?: () => boolean;
  run: CuaAdapter["run"];
}): CuaAdapter {
  return {
    name: options.name,
    description: options.description,
    available: options.available ?? (() => true),
    run: options.run,
  };
}
