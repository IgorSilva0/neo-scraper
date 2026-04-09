const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/collection", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  const url = `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection&subtab=0`;

  let browser;
  try {
  browser = await puppeteer.launch({
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/nix/var/nix/profiles/default/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (["image", "stylesheet", "font", "media"].includes(r.resourceType())) {
        r.abort();
      } else {
        r.continue();
      }
    });

    const rscPayloads = [];
    page.on("response", async (response) => {
      const ct = response.headers()["content-type"] ?? "";
      if (ct.includes("text/x-component")) {
        try {
          const buffer = await response.buffer();
          const text = new TextDecoder("utf-8").decode(buffer);
          rscPayloads.push(text);
        } catch { /* ignore */ }
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Poll up to 30s for payload with collection data
    let charPayload = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      charPayload = rscPayloads.find(t =>
        t.includes('"tId"') && t.includes('"collections"')
      );
      if (charPayload) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (!charPayload) {
      return res.status(500).json({ error: "Collection payload not found" });
    }

    // Parse RSC format
    const parsed = {};
    for (const line of charPayload.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const id = line.slice(0, colonIdx);
      const raw = line.slice(colonIdx + 1);
      try {
        parsed[id] = JSON.parse(raw);
      } catch { /* skip */ }
    }

    // Fix mojibake
    const fixEncoding = (val) => {
      if (typeof val === "string") {
        try { return decodeURIComponent(escape(val)); } catch { return val; }
      }
      if (Array.isArray(val)) return val.map(fixEncoding);
      if (val && typeof val === "object") {
        return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, fixEncoding(v)]));
      }
      return val;
    };

    res.json(fixEncoding(parsed));

  } catch (err) {
    res.status(500).json({ error: "Puppeteer failed", detail: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(process.env.PORT || 3001, () => console.log("Running"));