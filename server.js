import express from "express";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.text());

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;

const isProd = process.env.NODE_ENV === "production";

// Configure Vite middleware for React client in development
let vite;
if (!isProd) {
  vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);
} else {
  // Production middleware for serving static assets from dist/client
  app.use((await import("compression")).default());
  app.use(
    (await import("serve-static")).default(resolve(__dirname, "./dist/client"), {
      index: false,
    }),
  );
}

const sessionConfig = JSON.stringify({
  session: {
    type: "realtime",
    model: "gpt-realtime",
    audio: {
      output: {
        voice: "marin",
      },
    },
  },
});

// All-in-one SDP request (experimental)
app.post("/session", async (req, res) => {
  const fd = new FormData();
  console.log(req.body);
  fd.set("sdp", req.body);
  fd.set("session", sessionConfig);

  const r = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      "OpenAI-Beta": "realtime=v1",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: fd,
  });
  const sdp = await r.text();
  console.log(sdp);

  // Send back the SDP we received from the OpenAI REST API
  res.send(sdp);
});

// API route for ephemeral token generation
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: sessionConfig,
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    let template, render;
    if (!isProd) {
      // In development, use Vite's transformIndexHtml and load the source SSR module
      template = await vite.transformIndexHtml(
        url,
        fs.readFileSync("./client/index.html", "utf-8"),
      );
      ({ render } = await vite.ssrLoadModule("./client/entry-server.jsx"));
    } else {
      // In production, use the pre-built index.html and SSR bundle
      template = fs.readFileSync(
        resolve(__dirname, "./dist/client/index.html"),
        "utf-8",
      );
      ({ render } = await import("./dist/server/entry-server.js"));
    }

    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    if (!isProd) {
      vite.ssrFixStacktrace(e);
    }
    next(e);
  }
});

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
