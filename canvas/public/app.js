// ── Theme Toggle ───────────────────────────────────────────────────────────────
(function initTheme() {
  const toggle = document.getElementById("theme-toggle");
  const stored = localStorage.getItem("pandaclaw-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored || (prefersDark ? "dark" : "light");

  document.documentElement.setAttribute("data-theme", theme);
  toggle.textContent = theme === "dark" ? "🌙" : "☀️";

  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("pandaclaw-theme", next);
    toggle.textContent = next === "dark" ? "🌙" : "☀️";
  });
})();

// ── WebSocket ──────────────────────────────────────────────────────────────────
const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProto}//${location.host}/ws`);
const logContainer = document.getElementById("terminal-logs");

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    const entry = document.createElement("div");

    if (data.type === "canvas_update") {
      const { action, data: payload } = data;
      entry.className = "log-entry system";
      entry.textContent = `[canvas] ${action}`;
      logContainer.appendChild(entry);
      logContainer.scrollTop = logContainer.scrollHeight;

      const container = document.getElementById("html-card-container");
      if (action === "draw_rect") {
        bgLabel.style.display = "none";
        const p = payload || {};
        ctx.strokeStyle = p.color || "#5b4d9e";
        ctx.lineWidth = p.lineWidth || 2;
        ctx.strokeRect(p.x || 0, p.y || 0, p.width || 50, p.height || 50);
        if (p.label) {
          ctx.fillStyle = p.color || "#e8dcf8";
          ctx.font = "12px JetBrains Mono";
          ctx.fillText(p.label, (p.x || 0) + 5, (p.y || 0) + 15);
        }
      } else if (action === "render_html") {
        bgLabel.style.display = "none";
        if (payload?.clearFirst) container.innerHTML = "";
        const card = document.createElement("div");
        Object.assign(card.style, {
          background: "var(--surface)",
          border: "1px solid var(--panel-border)",
          borderRadius: "10px",
          padding: "14px",
          color: "var(--text)",
          width: payload?.width || "90%",
          pointerEvents: "auto",
          boxSizing: "border-box",
        });
        card.innerHTML = payload?.html || "";
        container.appendChild(card);
      } else if (action === "clear_canvas") {
        drawGrid();
        container.innerHTML = "";
        bgLabel.style.display = "block";
      }
      return;
    }

    entry.className = `log-entry ${data.type || "system"}`;
    if (data.type === "input")       entry.textContent = `[in]  > ${data.text}`;
    else if (data.type === "output") entry.textContent = `[out] < ${data.text}`;
    else                             entry.textContent = `[system] ${data.text || JSON.stringify(data)}`;

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  } catch (err) {
    console.error("WS error:", err);
  }
};

// ── Chat ───────────────────────────────────────────────────────────────────────
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";

  const userEl = document.createElement("div");
  userEl.className = "message user";
  userEl.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(userEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  const thinkEl = document.createElement("div");
  thinkEl.className = "message assistant";
  thinkEl.innerHTML = `<div class="msg-bubble">🐼 <em>Thinking...</em></div>`;
  chatMessages.appendChild(thinkEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    thinkEl.innerHTML = `<div class="msg-bubble">🐼 <strong>PandaClaw:</strong> ${escapeHtml(data.reply)}</div>`;
  } catch {
    thinkEl.innerHTML = `<div class="msg-bubble" style="color:var(--danger)">❌ Error sending message</div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Canvas ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("visual-canvas");
const ctx = canvas.getContext("2d");
const coordsDisplay = document.getElementById("coords-display");
const clearBtn = document.getElementById("clear-canvas-btn");
const bgLabel = document.querySelector(".mock-bg-label");

let isDrawing = false;
let startX = 0, startY = 0;

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.min(640, rect.width - 4);
  const aspect = canvas.height / canvas.width;
  canvas.width = w;
  canvas.height = Math.round(w * aspect);
  drawGrid();
}
window.addEventListener("resize", resizeCanvas);

function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(91, 77, 158, 0.1)";
  ctx.lineWidth = 1;
  const step = Math.max(15, Math.round(canvas.width / 32));
  for (let x = step; x < canvas.width; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = step; y < canvas.height; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}
drawGrid();

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  startX = e.clientX - rect.left;
  startY = e.clientY - rect.top;
  isDrawing = true;
  bgLabel.style.display = "none";
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = Math.round(e.clientX - rect.left);
  const cy = Math.round(e.clientY - rect.top);
  coordsDisplay.textContent = `X: ${cx}, Y: ${cy}`;
  if (!isDrawing) return;
  drawGrid();
  ctx.strokeStyle = "#5b4d9e";
  ctx.lineWidth = 2;
  ctx.strokeRect(startX, startY, cx - startX, cy - startY);
  ctx.fillStyle = "#e8dcf8";
  ctx.font = "10px JetBrains Mono";
  ctx.fillText(`[${startX}, ${startY}] → [${cx}, ${cy}]`, startX + 5, startY + 15);
});

canvas.addEventListener("mouseup", () => { isDrawing = false; });
clearBtn.addEventListener("click", () => { drawGrid(); bgLabel.style.display = "block"; });

// ── Tabs ───────────────────────────────────────────────────────────────────────
const tabLogs = document.getElementById("tab-logs");
const tabDiffs = document.getElementById("tab-diffs");
const panelLogs = document.getElementById("panel-logs");
const panelDiffs = document.getElementById("panel-diffs");

tabLogs.addEventListener("click", () => {
  tabLogs.classList.add("active");
  tabDiffs.classList.remove("active");
  panelLogs.classList.remove("hidden");
  panelDiffs.classList.add("hidden");
});

tabDiffs.addEventListener("click", () => {
  tabDiffs.classList.add("active");
  tabLogs.classList.remove("active");
  panelDiffs.classList.remove("hidden");
  panelLogs.classList.add("hidden");
  document.getElementById("diff-content").innerHTML = `
<span style="color:#6b7280;">diff --git a/src/index.ts b/src/index.ts</span>
<span style="color:#6b7280;">--- a/src/index.ts</span>
<span style="color:#6b7280;">+++ b/src/index.ts</span>
<span style="color:#9f1239;">-const VERSION = "2.0.0";</span>
<span style="color:#115e59;">+const VERSION = "3.0.0";</span>`;
});

document.getElementById("btn-approve").addEventListener("click", () => {
  alert("Mutation approved."); tabLogs.click();
});
document.getElementById("btn-decline").addEventListener("click", () => {
  alert("Mutation declined."); tabLogs.click();
});
