const FLAG = Symbol.for("workstate.quiet");

if (!(process as { [FLAG]?: boolean })[FLAG]) {
  (process as { [FLAG]?: boolean })[FLAG] = true;
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning instanceof Error ? `${warning.name} ${warning.message}` : String(warning ?? "");
    const extra = args
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "type" in part) return String((part as { type: unknown }).type);
        return "";
      })
      .join(" ");
    if (/ExperimentalWarning/.test(`${message} ${extra}`) && /sqlite/i.test(`${message} ${extra}`)) return;
    return original(warning as string, ...(args as []));
  }) as typeof process.emitWarning;
}
