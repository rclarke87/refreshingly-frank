// Local dev server: rebuild on change, serve _site, live reload.
// Uses Node built-ins only, so the dependency tree stays free of the
// vulnerable chokidar 3 / braces chain (see DEPLOYMENT.md).
import { watch, createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
const eleventyBin = join(process.cwd(), "node_modules", "@11ty", "eleventy", "cmd.cjs");

const PORT = Number(process.env.PORT) || 8080;
const ROOT = "_site";
const clients = new Set();
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".xml": "application/xml", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
};
const reloadSnippet = `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>`;

let building = false, queued = false;
async function build() {
  if (building) { queued = true; return; }
  building = true;
  try {
    // Fresh process per build: Eleventy caches template content in memory,
    // so reusing one process would serve stale pages.
    const code = await new Promise((done) =>
      spawn(process.execPath, [eleventyBin, "--quiet"], { stdio: "inherit" }).on("close", done)
    );
    if (code === 0) {
      console.log("[dev] Built");
      for (const res of clients) res.write("data: reload\n\n");
    } else {
      console.error("[dev] Build failed, fix the error above and save again");
    }
  } finally {
    building = false;
    if (queued) { queued = false; build(); }
  }
}

let timer;
watch("src", { recursive: true }, (_event, file) => {
  clearTimeout(timer);
  timer = setTimeout(() => { console.log(`[dev] Changed: ${file}`); build(); }, 120);
});

function resolveFile(urlPath) {
  const safe = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = join(ROOT, safe);
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
    return { file, status: 200 };
  } catch {
    return { file: join(ROOT, "404.html"), status: 404 };
  }
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const { file, status } = resolveFile(pathname);
  const type = types[extname(file)] || "application/octet-stream";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  if (type.startsWith("text/html")) {
    const chunks = [];
    createReadStream(file).on("data", (c) => chunks.push(c)).on("end", () => {
      res.end(Buffer.concat(chunks).toString().replace("</body>", `${reloadSnippet}</body>`));
    }).on("error", () => res.end());
  } else {
    createReadStream(file).on("error", () => res.end()).pipe(res);
  }
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[dev] Port ${PORT} is busy. Try: PORT=8081 npm run dev`);
    process.exit(1);
  }
  throw err;
}).listen(PORT, async () => {
  await build();
  console.log(`[dev] Serving http://localhost:${PORT} (live reload on)`);
});
