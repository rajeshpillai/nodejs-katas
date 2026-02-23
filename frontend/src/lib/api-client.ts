const API_BASE = "/api";

export interface KataSummary {
  id: string;
  sequence: number;
  title: string;
}

export interface PhaseGroup {
  phase: number;
  title: string;
  katas: KataSummary[];
}

export interface KataListResponse {
  phases: PhaseGroup[];
}

export interface Kata {
  id: string;
  phase: number;
  phaseTitle: string;
  sequence: number;
  title: string;
  difficulty: string;
  tags: string[];
  estimatedMinutes: number;
  concept: string;
  keyInsight: string;
  experimentCode: string;
  expectedOutput: string;
  challenge: string;
  deepDive: string;
  commonMistakes: string;
  description: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  success: boolean;
  execution_time_ms: number;
  error: string | null;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return res.json();
}
