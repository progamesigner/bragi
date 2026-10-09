// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import { LOCALES } from "./lib/i18n/locales";
import { THEME_COLORS } from "./lib/theme";

// Applies the saved theme, its browser colour and the language before first paint so nothing flashes.
const bootstrap = `try{var d=document.documentElement,t=localStorage.getItem("bragi-theme"),l=localStorage.getItem("bragi-locale"),c=${JSON.stringify(THEME_COLORS)};d.dataset.theme=t==="dark"||t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(${JSON.stringify(LOCALES)}.indexOf(l)>=0)d.lang=l;var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=c[d.dataset.theme]}catch(e){}`;

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="zh-Hant">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#171512" />
          <title>Bragi</title>
          <script innerHTML={bootstrap} />
          <link rel="manifest" href="/manifest.webmanifest" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
