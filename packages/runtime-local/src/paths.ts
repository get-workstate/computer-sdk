import path from "node:path";

export interface VirtualRoots {
  files: string;
  skills: string;
}

export function pathError(message: string): Error {
  return Object.assign(new Error(message), { status: 400, code: "path_outside_environment" });
}

export function resolveVirtual(
  roots: VirtualRoots,
  virtualPath: string,
): { real: string; virtual: string; root: "files" | "skills" } {
  if (typeof virtualPath !== "string" || !virtualPath.startsWith("/")) {
    throw pathError("Path must be absolute and stay inside /workspace or /workstate/skills.");
  }

  const normalized = path.posix.normalize(virtualPath);
  let rootReal: string;
  let rootVirtual: string;
  let kind: "files" | "skills";

  if (normalized === "/workspace" || normalized.startsWith("/workspace/")) {
    rootReal = roots.files;
    rootVirtual = "/workspace";
    kind = "files";
  } else if (normalized === "/workstate/skills" || normalized.startsWith("/workstate/skills/")) {
    rootReal = roots.skills;
    rootVirtual = "/workstate/skills";
    kind = "skills";
  } else {
    throw pathError(`Path ${virtualPath} is outside the environment. Use /workspace or /workstate/skills.`);
  }

  const relative = normalized.slice(rootVirtual.length).replace(/^\//, "");
  if (relative.split("/").includes("..")) {
    throw pathError(`Path ${virtualPath} escapes the environment.`);
  }

  const real = path.resolve(rootReal, relative);
  const rootResolved = path.resolve(rootReal);
  if (real !== rootResolved && !real.startsWith(rootResolved + path.sep)) {
    throw pathError(`Path ${virtualPath} escapes the environment.`);
  }

  return { real, virtual: relative ? `${rootVirtual}/${relative}` : rootVirtual, root: kind };
}

export function rewriteCommand(roots: VirtualRoots, command: string): string {
  const skills = path.resolve(roots.skills);
  const files = path.resolve(roots.files);
  return command.replaceAll("/workstate/skills", skills).replaceAll("/workspace", files);
}
