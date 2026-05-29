// WebSocket connection for live terminal log streaming
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);

const logContainer = document.getElementById("terminal-logs");

ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    const entry = document.createElement("div");
    entry.className = `log-entry ${data.type || "system"}`;
    
    if (data.type === "input") {
      entry.textContent = `[inbound] > ${data.text}`;
    } else if (data.type === "output") {
      entry.textContent = `[outbound] < ${data.text}`;
    } else {
      entry.textContent = `[system] ${data.text || JSON.stringify(data)}`;
    }
    
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  } catch (err) {
    console.error("WS parse error:", err);
  }
};

// Chat Form Interaction
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = "";

  // Append user message
  const userMsg = document.createElement("div");
  userMsg.className = "message user";
  userMsg.innerHTML = `<div class="msg-bubble">${text}</div>`;
  chatMessages.appendChild(userMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  // Show thinking placeholder
  const thinkMsg = document.createElement("div");
  thinkMsg.className = "message assistant";
  thinkMsg.innerHTML = `<div class="msg-bubble">🐼 <em>Thinking deliberate traces...</em></div>`;
  chatMessages.appendChild(thinkMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();

    // Replace thinking message with real reply
    thinkMsg.innerHTML = `<div class="msg-bubble">🐼 <strong>PandaClaw:</strong> ${data.reply}</div>`;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } catch (err) {
    thinkMsg.innerHTML = `<div class="msg-bubble" style="color: red;">❌ Error sending message.</div>`;
  }
});

// Interactive Drawing on Canvas
const canvas = document.getElementById("visual-canvas");
const ctx = canvas.getContext("2d");
const coordsDisplay = document.getElementById("coords-display");
const clearBtn = document.getElementById("clear-canvas-btn");
const bgLabel = document.querySelector(".mock-bg-label");

let isDrawing = false;
let startX = 0;
let startY = 0;

// Draw custom grid layout initially
function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(91, 77, 158, 0.1)";
  ctx.lineWidth = 1;

  for (let i = 20; i < canvas.width; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, canvas.height);
    ctx.stroke();
  }

  for (let j = 20; j < canvas.height; j += 20) {
    ctx.beginPath();
    ctx.moveTo(0, j);
    ctx.lineTo(canvas.width, j);
    ctx.stroke();
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
  const currentX = Math.round(e.clientX - rect.left);
  const currentY = Math.round(e.clientY - rect.top);

  coordsDisplay.textContent = `X: ${currentX}, Y: ${currentY}`;

  if (!isDrawing) return;

  drawGrid();

  // Draw bounding box selection
  ctx.strokeStyle = "#5b4d9e";
  ctx.lineWidth = 2;
  ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);

  // Label coordinates
  ctx.fillStyle = "#e8dcf8";
  ctx.font = "10px JetBrains Mono";
  ctx.fillText(`[${startX}, ${startY}] to [${currentX}, ${currentY}]`, startX + 5, startY + 15);
});

canvas.addEventListener("mouseup", () => {
  isDrawing = false;
});

clearBtn.addEventListener("click", () => {
  drawGrid();
  bgLabel.style.display = "block";
});

// Navigation Tabs (Logs / Diffs)
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

  // Load a mock diff to demonstrate the feature
  const diffBody = document.getElementById("diff-content");
  diffBody.innerHTML = `
<span style="color: #6b7280;">diff --git a/src/index.ts b/src/index.ts</span>
<span style="color: #6b7280;">--- a/src/index.ts</span>
<span style="color: #6b7280;">+++ b/src/index.ts</span>
<span style="color: #9f1239;">-const VERSION = "2.0.0";</span>
<span style="color: #115e59;">+const VERSION = "3.0.0"; // PandaClaw v3 is now active!</span>
  `;
});

// Diff Approvals
document.getElementById("btn-approve").addEventListener("click", () => {
  alert("Proposed mutation APPROVED. Writing changes to file system.");
  tabLogs.click();
});

document.getElementById("btn-decline").addEventListener("click", () => {
  alert("Proposed mutation DECLINED. Rolling back transaction changes.");
  tabLogs.click();
});
