import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { load as parseYaml } from "js-yaml";

function parseFrontmatter(content) {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error("No frontmatter found");
  }
  const rest = trimmed.slice(3);
  const endIdx = rest.indexOf("\n---");
  if (endIdx === -1) throw new Error("Unclosed frontmatter");
  const yaml = rest.slice(0, endIdx);
  const body = rest.slice(endIdx + 4).trimStart();
  return { fm: parseYaml(yaml), body };
}

function parseSections(body) {
  const sections = {};
  let currentSection = null;
  let lines = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (currentSection !== null) {
        sections[currentSection] = lines.join("\n");
      }
      currentSection = line.slice(3).trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (currentSection !== null) {
    sections[currentSection] = lines.join("\n");
  }
  return sections;
}

function extractCodeBlock(section) {
  if (!section) return "";
  const match = section.match(/```(?:javascript|js)\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : "";
}

function buildDescription(sections) {
  const order = [
    "Concept",
    "Key Insight",
    "Expected Output",
    "Challenge",
    "Deep Dive",
    "Common Mistakes",
  ];
  return order
    .filter((k) => sections[k])
    .map((k) => `## ${k}\n\n${sections[k].trim()}`)
    .join("\n\n---\n\n");
}

function parseKataFile(content) {
  const { fm, body } = parseFrontmatter(content);
  const sections = parseSections(body);

  return {
    id: fm.id,
    phase: fm.phase,
    phaseTitle: fm.phase_title,
    sequence: fm.sequence,
    title: fm.title,
    difficulty: fm.difficulty ?? "beginner",
    tags: fm.tags ?? [],
    estimatedMinutes: fm.estimated_minutes ?? 10,
    concept: (sections["Concept"] ?? "").trim(),
    keyInsight: (sections["Key Insight"] ?? "").trim(),
    experimentCode: extractCodeBlock(sections["Experiment"]),
    expectedOutput: (sections["Expected Output"] ?? "").trim(),
    challenge: (sections["Challenge"] ?? "").trim(),
    deepDive: (sections["Deep Dive"] ?? "").trim(),
    commonMistakes: (sections["Common Mistakes"] ?? "").trim(),
    description: buildDescription(sections),
  };
}

export async function loadAllKatas(katasDir) {
  const entries = await readdir(katasDir, { withFileTypes: true });
  const phaseDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("phase-"))
    .map((e) => e.name)
    .sort();

  const katas = [];
  for (const dir of phaseDirs) {
    const dirPath = join(katasDir, dir);
    const files = await readdir(dirPath);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
    for (const file of mdFiles) {
      const filePath = join(dirPath, file);
      const content = await readFile(filePath, "utf-8");
      katas.push(parseKataFile(content));
    }
  }
  return katas;
}
