const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");

const app = express();
app.use(cors());

const ROUTER_STATE = decodeURIComponent("%5B%22%22%2C%7B%22children%22%3A%5B%22(routes)%22%2C%7B%22children%22%3A%5B%22(with-layout)%22%2C%7B%22children%22%3A%5B%22(marketing)%22%2C%7B%22children%22%3A%5B%22character%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D");

let browser = null;
let sessionPage = null;
let sessionCookies = null;
let sessionHashes = null;
let lastSessionRefresh = 0;
const SESSION_MAX_AGE_MS = 8 * 60 * 1000;

async function getBrowser() {
  if (!browser || !browser.connected) {
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
      ],
    });
  }
  return browser;
}

async function refreshSession() {
  console.log("Refreshing session...");
  const b = await getBrowser();

  if (sessionPage) {
    try { await sessionPage.close(); } catch {}
  }

  sessionPage = await b.newPage();

  // Hide webdriver
  await sessionPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Intercept JS to extract action hashes
  const foundHashes = [];
  sessionPage.on("response", async (response) => {
    const url = response.url();
    if (!url.endsWith(".js") && !url.includes(".js?")) return;
    try {
      const text = await response.text();
      // Try both 40-char and 42-char hex hashes starting with "40"
      const matches = text.match(/["']40[a-f0-9]{38,42}["']/g);
      if (matches) {
        matches.forEach(m => {
          const hash = m.replace(/["']/g, "");
          if (!foundHashes.includes(hash)) {
            foundHashes.push(hash);
            console.log("Found action hash:", hash);
          }
        });
      }
    } catch {}
  });

  await sessionPage.goto("https://www.neogames.online/character?name=Pardal", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // Wait for JS challenge to complete
  await new Promise(r => setTimeout(r, 5000));

  sessionCookies = await sessionPage.cookies();
  console.log("Session cookies:", sessionCookies.map(c => c.name));
  console.log("All found hashes:", foundHashes);

  // Also try extracting hashes from page source directly
  if (foundHashes.length < 2) {
    console.log("Trying to extract hashes from page source...");
    try {
      const pageContent = await sessionPage.content();
      const matches = pageContent.match(/["']40[a-f0-9]{38,42}["']/g);
      if (matches) {
        matches.forEach(m => {
          const hash = m.replace(/["']/g, "");
          if (!foundHashes.includes(hash)) {
            foundHashes.push(hash);
            console.log("Found hash in page source:", hash);
          }
        });
      }
    } catch (e) {
      console.log("Page source extraction failed:", e.message);
    }
  }

  // Also intercept network requests to capture next-action headers from actual XHR
  console.log("Triggering collection tab to capture hashes from live requests...");
  const capturedActions = [];
  sessionPage.on("request", (request) => {
    const action = request.headers()["next-action"];
    if (action && !capturedActions.includes(action)) {
      capturedActions.push(action);
      console.log("Captured next-action from request:", action);
    }
  });

  // Navigate to collection tab to trigger both actions
  try {
    await sessionPage.goto(
      "https://www.neogames.online/character?name=Pardal&menu=information&tab=collection&subtab=0",
      { waitUntil: "networkidle2", timeout: 30000 }
    );
    await new Promise(r => setTimeout(r, 3000));
  } catch {}

  console.log("Captured actions from requests:", capturedActions);

  // Prefer captured actions from live requests (most reliable)
  if (capturedActions.length >= 2) {
    sessionHashes = capturedActions;
  } else if (capturedActions.length > 0) {
    sessionHashes = [...capturedActions, ...foundHashes.filter(h => !capturedActions.includes(h))];
  } else {
    sessionHashes = foundHashes;
  }

  console.log("Final hashes:", sessionHashes);
  lastSessionRefresh = Date.now();
}

async function getSession() {
  if (Date.now() - lastSessionRefresh > SESSION_MAX_AGE_MS) {
    await refreshSession();
  }
  return { cookies: sessionCookies, hashes: sessionHashes };
}

async function serverAction(url, action, body) {
  const { cookies } = await getSession();
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.setCookie(...cookies);

    const result = await page.evaluate(async ({ url, action, body, ROUTER_STATE }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "accept": "text/x-component",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
          "content-type": "text/plain;charset=UTF-8",
          "next-action": action,
          "next-router-state-tree": ROUTER_STATE,
          "origin": "https://www.neogames.online",
          "referer": "https://www.neogames.online/character",
        },
        body,
      });
      return await res.text();
    }, { url, action, body, ROUTER_STATE });

    return result;
  } finally {
    await page.close();
  }
}

function parseFlightResponse(text) {
  const parsed = {};
  for (const line of text.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const id = line.slice(0, colonIdx);
    const raw = line.slice(colonIdx + 1);
    try { parsed[id] = JSON.parse(raw); }
    catch {}
  }
  return parsed;
}

app.get("/debug", async (req, res) => {
  const { hashes, cookies } = await getSession();
  res.json({
    hashes,
    cookieNames: cookies ? cookies.map(c => c.name) : [],
    lastRefresh: new Date(lastSessionRefresh).toISOString(),
  });
});

app.get("/debug/refresh", async (req, res) => {
  lastSessionRefresh = 0;
  await refreshSession();
  const { hashes, cookies } = await getSession();
  res.json({
    hashes,
    cookieNames: cookies ? cookies.map(c => c.name) : [],
  });
});

app.get("/character", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  try {
    const { hashes } = await getSession();
    const ACTION_LOOKUP = hashes[0];
    const ACTION_COLLECTION = hashes[1];

    if (!ACTION_LOOKUP || !ACTION_COLLECTION) {
      return res.status(500).json({ error: "Could not extract action hashes", hashes });
    }

    const lookupResult = await serverAction(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}`,
      ACTION_LOOKUP,
      `["${name}"]`
    );

    console.log("Lookup response:", lookupResult.substring(0, 200));

    const lookupParsed = parseFlightResponse(lookupResult);
    const character = lookupParsed["1"]?.character;
    const characterIdx = character?.characterIdx;

    if (!characterIdx) {
      return res.status(404).json({ error: "Character not found", raw: lookupResult.substring(0, 300) });
    }

    const collectionResult = await serverAction(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection&subtab=0`,
      ACTION_COLLECTION,
      `[${characterIdx}]`
    );

    console.log("Collection response:", collectionResult.substring(0, 200));

    const collectionParsed = parseFlightResponse(collectionResult);
    const collection = collectionParsed["1"];

    res.json({ character, collection });

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/collection", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  try {
    const { hashes } = await getSession();
    const ACTION_LOOKUP = hashes[0];
    const ACTION_COLLECTION = hashes[1];

    if (!ACTION_LOOKUP || !ACTION_COLLECTION) {
      return res.status(500).json({ error: "Could not extract action hashes", hashes });
    }

    const lookupResult = await serverAction(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}`,
      ACTION_LOOKUP,
      `["${name}"]`
    );

    const lookupParsed = parseFlightResponse(lookupResult);
    const characterIdx = lookupParsed["1"]?.character?.characterIdx;

    if (!characterIdx) {
      return res.status(404).json({ error: "Character not found", raw: lookupResult.substring(0, 300) });
    }

    const collectionResult = await serverAction(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection`,
      ACTION_COLLECTION,
      `[${characterIdx}]`
    );

    const collectionParsed = parseFlightResponse(collectionResult);
    const payload = collectionParsed["1"];

    if (!payload?.data || !payload?.values) {
      return res.status(500).json({ error: "Collection payload not found", raw: collectionResult.substring(0, 500) });
    }

    res.json(payload);

  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Warm up session on startup
getBrowser().then(() => refreshSession()).catch(console.error);

app.listen(process.env.PORT || 3001, () => console.log("Running"));