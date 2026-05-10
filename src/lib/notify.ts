// Client-side helpers to attract the user's attention when a prompt finishes
// generating. Three channels:
//   - Tab title: prefix with a marker while the tab is hidden; revert when it
//     becomes visible again.
//   - Push notification: show a browser notification if the window is not
//     focused and permission was granted.
//   - Ding sound: play /ding.mp3 once.
//
// Both are no-ops on the server.

const TITLE_PREFIX = "(✓) ";
const PUSH_NOTIFICATION_TITLE = "Generation complete";
const PUSH_NOTIFICATION_BODY = "Your images are ready.";
const PUSH_NOTIFICATION_PARTIAL_FAILURE_BODY = "Some images failed. Return to AI Thing to review.";
const PUSH_NOTIFICATION_TOTAL_FAILURE_BODY = "All images failed. Return to AI Thing to review.";

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

function windowHasFocus() {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}

type NotifyPromptDoneOptions = {
  failureState?: "none" | "some" | "all";
};

function notificationBody(failureState: NotifyPromptDoneOptions["failureState"]) {
  if (failureState === "all") return PUSH_NOTIFICATION_TOTAL_FAILURE_BODY;
  if (failureState === "some") return PUSH_NOTIFICATION_PARTIAL_FAILURE_BODY;
  return PUSH_NOTIFICATION_BODY;
}

function sendPushNotification(options: NotifyPromptDoneOptions = {}) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (windowHasFocus()) return;

  try {
    new Notification(PUSH_NOTIFICATION_TITLE, {
      body: notificationBody(options.failureState),
    });
  } catch {
    /* ignore */
  }
}

/**
 * Notify the user that a prompt finished generating. Marks the tab title if
 * the tab is currently hidden, sends a push notification if the window is not
 * focused and permission was granted, and plays a ding either way.
 */
export function notifyPromptDone(options: NotifyPromptDoneOptions = {}) {
  if (typeof document !== "undefined" && document.hidden) {
    markTitle();
  }
  sendPushNotification(options);
  playDing();
}
