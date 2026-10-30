import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(skillDir, "template.html");
const root = process.cwd();
const configPath = path.join(root, "roadmap.config.json");
const examplePath = path.join(skillDir, "roadmap.config.example.json");

const VIEWPORT_WIDTH = 1600;
const SHOT_SCALE = 2;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readEnvKey(envPath) {
  if (!fs.existsSync(envPath)) return "";
  const raw = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() !== "REDMINE_API_KEY") continue;
    return trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    fail(
      "roadmap.config.json não encontrado na raiz do checkout. Copie " +
        examplePath +
        " para " +
        configPath +
        " e preencha antes de executar."
    );
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    fail("roadmap.config.json não é um JSON válido.");
  }
  const projects = Array.isArray(config.projects) ? config.projects.map((id) => String(id).trim()).filter(Boolean) : [];
  if (projects.length === 0) fail("Lista de projetos vazia. Preencha projects em roadmap.config.json.");
  for (const id of projects) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) fail("Identificador de projeto inválido: " + id);
  }
  let apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  if (!apiKey) apiKey = readEnvKey(path.join(root, ".env"));
  if (!apiKey) fail("Chave vazia. Preencha apiKey em roadmap.config.json ou REDMINE_API_KEY no .env.");
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) fail("baseUrl ausente ou inválida em roadmap.config.json.");
  const outputDir = path.resolve(root, config.outputDir || "output/roadmaps");
  return { projects, apiKey, baseUrl, outputDir };
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(iso) {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return match[3] + "/" + match[2] + "/" + match[1];
}

function dateLine(issue) {
  const start = fmt(issue.start_date);
  const due = fmt(issue.due_date);
  if (start && due) return start + " a " + due;
  if (start) return start;
  if (due) return due;
  return "Datas não informadas";
}

function statusView(name) {
  const map = {
    "Sprint Fechada": ["Finalizada", "green"],
    Finalizada: ["Finalizada", "green"],
    "Sprint Cancelada": ["Cancelada", "red"],
    Cancelada: ["Cancelada", "red"],
    "Sprint Aberta": ["Aberta", "blue"],
    "Execução da Sprint": ["Aberta", "blue"],
    Aberta: ["Aberta", "blue"],
    "Previsto(a)": ["Previsto(a)", "yellow"],
  };
  return map[name] || [name, "gray"];
}

function compareSprint(a, b) {
  const startA = a.start_date || "9999-12-31";
  const startB = b.start_date || "9999-12-31";
  if (startA !== startB) return startA < startB ? -1 : 1;
  const dueA = a.due_date || "9999-12-31";
  const dueB = b.due_date || "9999-12-31";
  if (dueA !== dueB) return dueA < dueB ? -1 : 1;
  return a.id - b.id;
}

function metaHtml(sprint) {
  const field = (sprint.custom_fields || []).find((item) => item.name === "Meta da Sprint");
  if (!field || field.value == null) return "";
  const text = String(field.value).replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  return esc(text).replace(/\n/g, "<br>\n");
}

function collectIssues(byParent, sprintId) {
  const out = [];
  const walk = (id) => {
    const kids = (byParent.get(id) || []).slice().sort((a, b) => a.id - b.id);
    for (const child of kids) {
      if (["Sprint", "MVP", "Incremento"].includes(child.tracker.name)) continue;
      out.push(child);
      walk(child.id);
    }
  };
  walk(sprintId);
  return out;
}

function card(sprint, side, issues) {
  const [label, color] = statusView(sprint.status.name);
  const meta = metaHtml(sprint);
  const lines = issues
    .map((issue) => "#" + issue.id + " - " + esc(issue.subject.trim()) + " (" + esc(issue.status.name) + ")")
    .join("<br>\n");
  return [
    '  <div class="container ' + side + '">',
    '    <div class="content">',
    "      <h2>" + esc(sprint.subject.trim()) + "</h2>",
    "      <p>" + dateLine(sprint) + "</p>",
    '      <p>STATUS = <font color="white" style="background-color: ' + color + ';">' + esc(label) + "</font></p>",
    meta ? "      <p> <b> " + meta + "</b></p>" : "",
    lines ? "      <p>\n" + lines + "\n      </p>" : "",
    "    </div>",
    "  </div>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function renderHtml(projectName, issues) {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const byParent = new Map();
  for (const issue of issues) {
    if (!issue.parent) continue;
    if (!byParent.has(issue.parent.id)) byParent.set(issue.parent.id, []);
    byParent.get(issue.parent.id).push(issue);
  }
  const mvp = [];
  const inc = [];
  const other = [];
  for (const sprint of issues.filter((issue) => issue.tracker && issue.tracker.name === "Sprint")) {
    const parent = sprint.parent ? byId.get(sprint.parent.id) : null;
    const tracker = parent && parent.tracker ? parent.tracker.name : "";
    if (tracker === "MVP") mvp.push(sprint);
    else if (tracker === "Incremento") inc.push(sprint);
    else other.push(sprint);
  }
  const first = mvp.concat(other).sort(compareSprint);
  inc.sort(compareSprint);
  const blocks = [];
  let index = 0;
  const push = (sprint) => {
    const side = index % 2 === 0 ? "left" : "right";
    blocks.push(card(sprint, side, collectIssues(byParent, sprint.id)));
    index += 1;
  };
  for (const sprint of first) push(sprint);
  if (inc.length) blocks.push('  <div class="timeline-mvp">\n\tMVP\n  </div>');
  for (const sprint of inc) push(sprint);
  const template = fs.readFileSync(templatePath, "utf8");
  return {
    html: template.split("{{TITLE}}").join(esc(projectName)).split("{{TIMELINE}}").join("\n" + blocks.join("\n") + "\n"),
    mvp: mvp.length,
    inc: inc.length,
    other: other.length,
  };
}

function apiGet(baseUrl, apiKey, pathname) {
  const url = new URL(baseUrl + pathname);
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = lib.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          "X-Redmine-API-Key": apiKey,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const route = pathname.split("?")[0];
          if (response.statusCode !== 200) {
            reject(new Error("A API respondeu HTTP " + response.statusCode + " em " + route));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("JSON inválido em " + route));
          }
        });
      }
    );
    request.on("error", (error) => {
      reject(new Error("Falha de rede ao consultar a API (" + error.message + ")"));
    });
    request.end();
  });
}

async function loadProject(baseUrl, apiKey, identifier) {
  const project = await apiGet(baseUrl, apiKey, "/projects/" + encodeURIComponent(identifier) + ".json");
  const issues = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await apiGet(
      baseUrl,
      apiKey,
      "/issues.json?project_id=" +
        encodeURIComponent(identifier) +
        "&status_id=*&limit=100&offset=" +
        offset +
        "&sort=id:asc"
    );
    const batch = page.issues || [];
    total = Number(page.total_count || 0);
    issues.push(...batch);
    if (batch.length === 0) break;
    offset += batch.length;
  }
  return { name: project.project.name, issues };
}

function findBrowser() {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(Boolean);
  const relatives = [
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
  ];
  for (const rootDir of roots) {
    for (const parts of relatives) {
      const candidate = path.join(rootDir, ...parts);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  fail("Chrome ou Edge não encontrado.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let data = "";
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("resposta inválida do navegador"));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(2000, () => {
      request.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function waitJson(url) {
  let last;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await getJson(url);
    } catch (error) {
      last = error;
      await sleep(200);
    }
  }
  throw last;
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("PNG inválido");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function screenshotAll(pages) {
  const browser = findBrowser();
  const port = 9400 + (process.pid % 500);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-chrome-"));
  const chrome = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--remote-debugging-port=" + port,
      "--user-data-dir=" + userData,
      "--window-size=" + VIEWPORT_WIDTH + ",900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  try {
    await waitJson("http://127.0.0.1:" + port + "/json/version");
    const targets = await waitJson("http://127.0.0.1:" + port + "/json/list");
    const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!page) throw new Error("O navegador não abriu uma página.");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", () => reject(new Error("Falha ao conectar no navegador")));
    });
    let nextId = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message || "erro do navegador"));
        else waiter.resolve(message.result || {});
      } else if (message.method) {
        events.push(message);
      }
    });
    const send = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
    const waitLoad = () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("A página do roadmap não terminou de carregar")), 60000);
        const check = () => {
          if (events.some((event) => event.method === "Page.loadEventFired")) {
            clearTimeout(timer);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    await send("Page.enable");
    for (const item of pages) {
      events.length = 0;
      await send("Emulation.setDeviceMetricsOverride", {
        width: VIEWPORT_WIDTH,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const navigation = await send("Page.navigate", { url: pathToFileURL(item.htmlPath).href });
      if (navigation.errorText) throw new Error("Não abriu o HTML de " + item.identifier);
      await waitLoad();
      await sleep(400);
      const metrics = await send("Page.getLayoutMetrics");
      const css = metrics.cssContentSize;
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: css.height, scale: SHOT_SCALE },
      });
      const buffer = Buffer.from(shot.data, "base64");
      fs.writeFileSync(item.pngPath, buffer);
      const size = pngSize(buffer);
      if (size.width !== VIEWPORT_WIDTH * SHOT_SCALE) {
        throw new Error(item.identifier + " saiu com largura " + size.width + " em vez de 3200");
      }
      item.pixels = size;
    }
    ws.close();
  } finally {
    chrome.kill();
    await sleep(300);
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

const config = loadConfig();
fs.mkdirSync(config.outputDir, { recursive: true });
const pages = [];
for (const identifier of config.projects) {
  const loaded = await loadProject(config.baseUrl, config.apiKey, identifier);
  const rendered = renderHtml(loaded.name, loaded.issues);
  const htmlPath = path.join(config.outputDir, identifier + ".html");
  const pngPath = path.join(config.outputDir, identifier + ".png");
  fs.writeFileSync(htmlPath, rendered.html, "utf8");
  pages.push({ identifier, htmlPath, pngPath, mvp: rendered.mvp, inc: rendered.inc });
  console.log(identifier + " html=" + htmlPath + " mvp=" + rendered.mvp + " inc=" + rendered.inc);
}
await screenshotAll(pages);
for (const item of pages) {
  console.log(item.identifier + " png=" + item.pngPath + " " + item.pixels.width + "x" + item.pixels.height);
}
