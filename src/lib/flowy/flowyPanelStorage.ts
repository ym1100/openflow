/**
 * Persist Flowy agent panel UI state (chat sessions, dock, custom instructions).
 */

export const FLOWY_SESSIONS_KEY = "openflows-flowy-sessions";
export const FLOWY_ACTIVE_SESSION_KEY = "openflows-flowy-active-session";
export const FLOWY_CUSTOM_INSTRUCTIONS_KEY = "openflows-flowy-custom-instructions";
export const FLOWY_DOCKED_KEY = "openflows-flowy-docked";

export const FLOWY_MAX_STORED_SESSIONS = 50;

export type StoredChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type StoredChatSession = {
  id: string;
  title: string;
  messages: StoredChatMsg[];
  createdAt: number;
};

export function createEmptyFlowySession(): StoredChatSession {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return { id, title: "New Chat", messages: [], createdAt: Date.now() };
}

export function parseStoredSessions(raw: string | null): StoredChatSession[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const out: StoredChatSession[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== "string" || !Array.isArray(s.messages)) continue;
      out.push({
        id: s.id,
        title: typeof s.title === "string" ? s.title : "Chat",
        messages: (s.messages as StoredChatMsg[]).filter(
          (m) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.text === "string"
        ),
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
      });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function loadFlowyPanelSessions(): { sessions: StoredChatSession[]; activeId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const sessions = parseStoredSessions(localStorage.getItem(FLOWY_SESSIONS_KEY));
    if (!sessions?.length) return null;
    const trimmed = [...sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, FLOWY_MAX_STORED_SESSIONS);
    const storedActive = localStorage.getItem(FLOWY_ACTIVE_SESSION_KEY);
    const activeId =
      storedActive && trimmed.some((s) => s.id === storedActive) ? storedActive : trimmed[0].id;
    return { sessions: trimmed, activeId };
  } catch {
    return null;
  }
}

export function saveFlowyPanelSessions(sessions: StoredChatSession[], activeId: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = [...sessions]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, FLOWY_MAX_STORED_SESSIONS);
    localStorage.setItem(FLOWY_SESSIONS_KEY, JSON.stringify(trimmed));
    localStorage.setItem(FLOWY_ACTIVE_SESSION_KEY, activeId);
  } catch {
    /* quota or private mode */
  }
}

export function loadCustomInstructions(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(FLOWY_CUSTOM_INSTRUCTIONS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveCustomInstructions(text: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FLOWY_CUSTOM_INSTRUCTIONS_KEY, text);
  } catch {
    /* ignore */
  }
}

export function loadDockedPreference(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(FLOWY_DOCKED_KEY) === "1";
}

export function saveDockedPreference(docked: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FLOWY_DOCKED_KEY, docked ? "1" : "0");
  } catch {
    /* ignore */
  }
}
