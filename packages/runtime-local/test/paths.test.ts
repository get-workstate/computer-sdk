import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalFiles } from "../dist/files.js";
import { resolveVirtual } from "../dist/paths.js";

test("resolves workspace and skills inside the environment", () => {
  const roots = { files: "/tmp/env/files", skills: "/tmp/env/skills" };
  const file = resolveVirtual(roots, "/workspace/invoices/INV-1042.txt");
  assert.equal(file.real, path.resolve("/tmp/env/files", "invoices", "INV-1042.txt"));
  const skill = resolveVirtual(roots, "/workstate/skills/download-latest-invoice.json");
  assert.equal(skill.real, path.resolve("/tmp/env/skills", "download-latest-invoice.json"));
  assert.equal(resolveVirtual(roots, "/workspace").virtual, "/workspace");
});

test("rejects paths outside the environment with status 400", () => {
  const roots = { files: "/tmp/env/files", skills: "/tmp/env/skills" };
  for (const bad of ["/etc/passwd", "/workspace/../secrets", "/workstate/skills/../../etc/passwd", "notes.txt", "/tmp/other"]) {
    assert.throws(
      () => resolveVirtual(roots, bad),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "path_outside_environment");
        assert.equal((error as { status?: number }).status, 400);
        return true;
      },
    );
  }
});

test("LocalFiles writes inside /workspace and rejects escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ws-files-"));
  const files = new LocalFiles({ files: path.join(root, "files"), skills: path.join(root, "skills") });
  await files.write("/workspace/invoices/INV-1042.txt", "hello\n");
  assert.equal(await files.read("/workspace/invoices/INV-1042.txt"), "hello\n");
  const listed = await files.list("/workspace");
  assert.equal(listed[0]?.name, "invoices");
  await assert.rejects(() => files.read("/etc/passwd"), (error: unknown) => (error as { status?: number }).status === 400);
});
