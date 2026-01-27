import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Email } from "../types/mail";

let composerWindowCount = 0;

export async function openComposerWindow(accountId: string, replyTo?: Email | null): Promise<void> {
  composerWindowCount++;
  const windowLabel = `composer-${composerWindowCount}`;

  // Build URL with parameters
  let url = `/composer.html?accountId=${encodeURIComponent(accountId)}`;
  if (replyTo) {
    url += `&replyTo=${encodeURIComponent(JSON.stringify(replyTo))}`;
  }

  // In development, use the dev server URL
  const isDev = import.meta.env.DEV;
  const fullUrl = isDev ? `http://localhost:5234${url}` : url;

  const webview = new WebviewWindow(windowLabel, {
    url: fullUrl,
    title: replyTo ? `Re: ${replyTo.subject}` : "Neue E-Mail",
    width: 800,
    height: 600,
    resizable: true,
    center: true,
    focus: true,
  });

  // Handle window errors
  webview.once("tauri://error", (e) => {
    console.error("Window creation error:", e);
  });
}
