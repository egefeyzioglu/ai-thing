// Client-side helpers to attract the user's attention when a prompt finishes
// generating. Two channels:
//   - Tab title: prefix with a marker while the tab is hidden; revert when it
//     becomes visible again.
//   - Ding sound: play /ding.mp3 once.
//
// Both are no-ops on the server.

const TITLE_PREFIX = "(✓) ";

let originalTitle: string | null = null;
let visibilityHandler: (() => void) | null = null;

function markTitle() {
  if (typeof document === "undefined") return;
  if (originalTitle !== null) return; // already marked
  originalTitle = document.title;
  document.title = TITLE_PREFIX + document.title;

  visibilityHandler = () => {
    if (!document.hidden) clearTitle();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function clearTitle() {
  if (typeof document === "undefined") return;
  if (originalTitle === null) return;
  document.title = originalTitle;
  originalTitle = null;
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

function playDing() {
  if (typeof window === "undefined") return;
  try {
    const audio = new Audio("/ding.mp3");
    // Best-effort; browsers may reject if there's been no user gesture, but
    // generation is always user-initiated so this should normally succeed.
    void audio.play().catch(() => {
      /* swallow autoplay errors */
    });
  } catch {
    /* ignore */
  }
}

/**
 * Notify the user that a prompt finished generating. Marks the tab title if
 * the tab is currently hidden, and plays a ding either way.
 */
export function notifyPromptDone() {
  if (typeof document !== "undefined" && document.hidden) {
    markTitle();
  }
  playDing();
}
