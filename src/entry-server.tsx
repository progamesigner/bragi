// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import { LOCALES } from "./lib/i18n/locales";

// Applies the saved theme and language before first paint so nothing flashes.
const bootstrap = `try{var d=document.documentElement,t=localStorage.getItem("bragi-theme"),l=localStorage.getItem("bragi-locale");d.dataset.theme=t==="dark"||t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(${JSON.stringify(LOCALES)}.indexOf(l)>=0)d.lang=l}catch(e){}`;

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
          <link rel="apple-touch-icon" href="/icon-192.png" />
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
