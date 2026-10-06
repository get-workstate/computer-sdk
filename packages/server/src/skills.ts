import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nowIso, type Skill, type SkillDraft, type Skills } from "@workstate/sdk";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class FilesystemSkills implements Skills {
  constructor(private readonly dir: string) {}

  async list(): Promise<Skill[]> {
    await mkdir(this.dir, { recursive: true });
    const names = await readdir(this.dir);
    const skills: Skill[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await readFile(path.join(this.dir, name), "utf8");
        skills.push(JSON.parse(raw) as Skill);
      } catch {
        // Skip unreadable skill files rather than failing the whole list.
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  async read(name: string): Promise<Skill | null> {
    this.assertName(name);
    try {
      const raw = await readFile(path.join(this.dir, `${name}.json`), "utf8");
      return JSON.parse(raw) as Skill;
    } catch {
      return null;
    }
  }

  async write(skill: SkillDraft): Promise<Skill> {
    this.assertName(skill.name);
    await mkdir(this.dir, { recursive: true });
    const existing = await this.read(skill.name);
    const saved: Skill = {
      name: skill.name,
      description: skill.description,
      tags: skill.tags.map((tag) => tag.toLowerCase()),
      procedure: skill.procedure,
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    await writeFile(path.join(this.dir, `${skill.name}.json`), JSON.stringify(saved, null, 2));
    return saved;
  }

  private assertName(name: string): void {
    if (!NAME_RE.test(name)) {
      throw Object.assign(new Error(`Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens.`), {
        status: 400,
        code: "invalid_skill",
      });
    }
  }
}
