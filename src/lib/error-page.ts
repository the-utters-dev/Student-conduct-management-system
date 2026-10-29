import { ICON_VERSION, iconLinksHtml, THEME_COLOR } from "./icons";

export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load — SCDMS</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="${THEME_COLOR}" />
    ${iconLinksHtml()}
    <style>
      :root { --bg: #f5f6fb; --card: #ffffff; --ink: #111827; --soft: #4b5563; --line: #d1d5db; --brand: #4f46e5; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #0b1020; --card: #121a2e; --ink: #f3f4f6; --soft: #9ca3af; --line: #374151; }
      }
      body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1rem; box-sizing: border-box; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem 1.5rem; background: var(--card); border: 1px solid var(--line); border-radius: 1.5rem; box-sizing: border-box; }
      .mark { width: 3rem; height: 3rem; margin: 0 auto 1rem; border-radius: 0.875rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: var(--soft); margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.75rem; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: var(--brand); color: #fff; }
      .secondary { background: transparent; color: var(--ink); border-color: var(--line); }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="mark" src="/favicon.svg?v=${ICON_VERSION}" alt="" width="48" height="48" />
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
