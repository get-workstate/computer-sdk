import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileEntry, Files } from "@workstate/sdk";
import { resolveVirtual, type VirtualRoots } from "./paths.js";

function annotate(error: unknown, virtualPath: string): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    throw Object.assign(new Error(`No such file ${virtualPath}`), { status: 404, code: "not_found" });
  }
  if (code === "EISDIR") {
    throw Object.assign(new Error(`${virtualPath} is a directory`), { status: 400, code: "is_directory" });
  }
  throw error;
}

export class LocalFiles implements Files {
  constructor(private readonly roots: VirtualRoots) {}

  async read(virtualPath: string): Promise<string> {
    const resolved = resolveVirtual(this.roots, virtualPath);
    try {
      const info = await stat(resolved.real);
      if (info.isDirectory()) {
        throw Object.assign(new Error(`${virtualPath} is a directory`), { status: 400, code: "is_directory" });
      }
      const buffer = await readFile(resolved.real);
      if (buffer.includes(0)) {
        throw Object.assign(new Error(`${virtualPath} is not a text file`), { status: 415, code: "binary_file" });
      }
      return buffer.toString("utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "is_directory" || (error as { code?: string }).code === "binary_file") {
        throw error;
      }
      annotate(error, virtualPath);
    }
  }

  async write(virtualPath: string, content: string): Promise<void> {
    const resolved = resolveVirtual(this.roots, virtualPath);
    await mkdir(path.dirname(resolved.real), { recursive: true });
    await writeFile(resolved.real, content, "utf8");
  }

  async list(virtualPath: string): Promise<FileEntry[]> {
    const resolved = resolveVirtual(this.roots, virtualPath);
    let entries;
    try {
      entries = await readdir(resolved.real, { withFileTypes: true });
    } catch (error) {
      annotate(error, virtualPath);
    }
    const listed: FileEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const virtual = `${resolved.virtual}/${entry.name}`;
      const real = path.join(resolved.real, entry.name);
      let size: number | undefined;
      if (entry.isFile()) {
        const info = await stat(real);
        size = info.size;
      }
      listed.push({
        name: entry.name,
        path: virtual,
        kind: entry.isDirectory() ? "dir" : "file",
        size,
      });
    }
    listed.sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name));
    return listed;
  }
}
