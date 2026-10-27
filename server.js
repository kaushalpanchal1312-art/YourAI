const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
// Free-tier model ID. Check current names in Google AI Studio and override with GEMINI_MODEL if needed.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_BODY_BYTES = 100 * 1024; // largest request body accepted
const MAX_MESSAGES = 30; // messages of history sent to the AI
const MAX_CHARS = 8000; // characters allowed per message
const RATE_LIMIT = 20; // AI requests per IP...
const WINDOW_MS = 60 * 1000; // ...per minute

const SYSTEM_PROMPT = `You are YourAi, a friendly and helpful AI assistant for everyday problems, school projects, studying, writing, and general questions.
- Give clear, accurate answers and keep them well organized and concise unless more detail is requested.
- For homework and school work, explain the reasoning and steps so the person learns, rather than only giving final answers.
- If you are unsure about something, say so.`;

const hits = new Map();

// Forget old rate-limit entries so memory does not grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.start > WINDOW_MS) hits.delete(ip);
  }
}, WINDOW_MS).unref();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  if (!API_KEY) {
    return sendJson(res, 500, {
      error: "The server is not configured yet. The owner needs to set GEMINI_API_KEY.",
    });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    if (err.message === "too_large") {
      return sendJson(res, 413, { error: "Your message is too large." });
    }
    return sendJson(res, 400, { error: "Invalid request." });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendJson(res, 400, { error: "No messages were sent." });
  }

  const messages = [];
  for (const m of body.messages.slice(-MAX_MESSAGES)) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string" ||
      !m.content.trim()
    ) {
      return sendJson(res, 400, { error: "Invalid message format." });
    }
    messages.push({ role: m.role, content: m.content.slice(0, MAX_CHARS) });
  }

  if (messages[messages.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "The last message must be from the user." });
  }

  // Gemini uses "model" where other APIs use "assistant".
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error("Gemini API error:", upstream.status, JSON.stringify(data));
      const message =
        upstream.status === 429
          ? "YourAi has reached its free usage limit for now. Please try again later."
          : "The AI service returned an error. Please try again in a moment.";
      return sendJson(res, 502, { error: message });
    }

    const reply = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return sendJson(res, 502, {
        error: "The AI gave an empty answer. Please try rephrasing your question.",
      });
    }

    return sendJson(res, 200, { reply });
  } catch (err) {
    console.error("Request to AI service failed:", err);
    return sendJson(res, 502, { error: "Could not reach the AI service. Please try again." });
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const requested = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  // Block attempts to read files outside the public folder.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const type = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") {
    const forwarded = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const ip = forwarded || req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      return sendJson(res, 429, {
        error: "You're sending messages too quickly. Please wait a minute and try again.",
      });
    }
    return handleChat(req, res);
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return serveStatic(req, res);
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`YourAI is running on http://localhost:${PORT}`);
  if (!API_KEY) {
    console.log("Warning: GEMINI_API_KEY is not set. Chat will not work until it is.");
  }
});
