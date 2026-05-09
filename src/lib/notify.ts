// Client-side helpers to attract the user's attention when a prompt finishes
// generating. Three channels:
//   - Tab title: prefix with a marker while the tab is hidden; revert when it
//     becomes visible again.
//   - Ding sound: play /ding.mp3 once.
//   - Browser notification: show one when the window is not focused.
//
// Both are no-ops on the server.

const TITLE_PREFIX = "(✓) ";
const NOTIFICATION_PROMPT_DISMISSED_KEY =
  "ai-thing:notification-prompt-dismissed";

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

function isWindowFocused() {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}

function canUseNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function wasNotificationPromptDismissed() {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.sessionStorage.getItem(NOTIFICATION_PROMPT_DISMISSED_KEY) === "true"
    );
  } catch {
    return false;
  }
}

export function dismissPromptDoneNotificationPrompt() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(NOTIFICATION_PROMPT_DISMISSED_KEY, "true");
  } catch {
    /* ignore */
  }
}

function showBrowserNotification() {
  if (!canUseNotifications()) return;
  if (Notification.permission !== "granted") return;

  try {
    const notification = new Notification("Generation complete", {
      body: "Your image generation has finished.",
      icon: "/favicon.ico",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* ignore */
  }
}

export function shouldPromptForPromptDoneNotifications() {
  if (!canUseNotifications()) return false;
  if (Notification.permission !== "default") return false;
  return !wasNotificationPromptDismissed();
}

export async function requestPromptDoneNotificationPermission() {
  if (!canUseNotifications()) return;
  if (Notification.permission !== "default") return;

  await Notification.requestPermission().catch(() => {
    /* ignore */
  });
}

/**
 * Notify the user that a prompt finished generating. Marks the tab title if
 * the tab is currently hidden, sends a browser notification when the window is
 * not focused, and plays a ding either way.
 */
export function notifyPromptDone() {
  if (typeof document !== "undefined" && document.hidden) {
    markTitle();
  }
  if (!isWindowFocused()) {
    showBrowserNotification();
  }
  playDing();
}
