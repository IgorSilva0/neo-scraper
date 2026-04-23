const express = require("express");
const cors = require("cors");
const { execSync } = require("child_process");

const app = express();
app.use(cors());

const ROUTER_STATE = "%5B%22%22%2C%7B%22children%22%3A%5B%22(routes)%22%2C%7B%22children%22%3A%5B%22(with-layout)%22%2C%7B%22children%22%3A%5B%22(marketing)%22%2C%7B%22children%22%3A%5B%22character%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D";
const ACTION_CHARACTER_LOOKUP = "00fcf30d43174133a5a6ddbee54861286a3e2ed74e";
const ACTION_COLLECTION = "406e831520fee0850a609e6c15cb179dec2cabac57";

const COOKIE_FILE = "/tmp/neo_cookies.txt";
const COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
let lastCookieFetch = 0;

function fetchCookies(name) {
  const now = Date.now();
  if (now - lastCookieFetch < COOKIE_MAX_AGE_MS) return;

  execSync(`curl_chrome110 \
    -s -o /dev/null \
    -c "${COOKIE_FILE}" \
    -H "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
    -H "accept-language: pt-BR,pt;q=0.9,en;q=0.8" \
    -H "origin: https://www.neogames.online" \
    "https://www.neogames.online/character?name=${encodeURIComponent(name)}"`,
    { timeout: 30000 }
  );

  lastCookieFetch = Date.now();
  console.log("Cookies refreshed");
}

function curlPost(url, action, body) {
  return execSync(`curl_chrome110 \
    -s \
    -X POST \
    -b "${COOKIE_FILE}" \
    -c "${COOKIE_FILE}" \
    -H "accept: text/x-component" \
    -H "accept-language: pt-BR,pt;q=0.9,en;q=0.8" \
    -H "content-type: text/plain;charset=UTF-8" \
    -H "next-action: ${action}" \
    -H "next-router-state-tree: ${ROUTER_STATE}" \
    -H "origin: https://www.neogames.online" \
    -H "referer: https://www.neogames.online/character" \
    --data-raw '${body}' \
    "${url}"`,
    { timeout: 30000 }
  ).toString();
}

function parseFlightResponse(text) {
  const parsed = {};
  for (const line of text.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const id = line.slice(0, colonIdx);
    const raw = line.slice(colonIdx + 1);
    try { parsed[id] = JSON.parse(raw); }
    catch { /* skip */ }
  }
  return parsed;
}

app.get("/collection", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  try {
    fetchCookies(name);

    const baseUrl = `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection`;

    const lookupResult = curlPost(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}`,
      ACTION_CHARACTER_LOOKUP,
      `["${name}"]`
    );

    console.log("Lookup response:", lookupResult.substring(0, 200));

    if (lookupResult.includes("Vercel Security Checkpoint")) {
      lastCookieFetch = 0; // force cookie refresh next time
      return res.status(503).json({ error: "Bot protection triggered" });
    }

    const lookupParsed = parseFlightResponse(lookupResult);
    const characterIdx = lookupParsed["1"]?.character?.characterIdx;

    if (!characterIdx) {
      return res.status(404).json({ error: "Character not found", raw: lookupResult.substring(0, 300) });
    }

    console.log("Found characterIdx:", characterIdx);

    const collectionResult = curlPost(
      baseUrl,
      ACTION_COLLECTION,
      `[${characterIdx}]`
    );

    console.log("Collection response:", collectionResult.substring(0, 200));

    if (collectionResult.includes("Vercel Security Checkpoint")) {
      lastCookieFetch = 0;
      return res.status(503).json({ error: "Bot protection triggered" });
    }

    const collectionParsed = parseFlightResponse(collectionResult);
    const payload = collectionParsed["1"];

    if (!payload?.data || !payload?.values) {
      return res.status(500).json({ error: "Collection payload not found", raw: collectionResult.substring(0, 500) });
    }

    res.json(payload);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/character", async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  try {
    fetchCookies(name);

    const lookupResult = curlPost(
      `https://www.neogames.online/character?name=${encodeURIComponent(name)}`,
      ACTION_CHARACTER_LOOKUP,
      `["${name}"]`
    );

    console.log("Lookup response:", lookupResult.substring(0, 200));

    if (lookupResult.includes("Vercel Security Checkpoint")) {
      lastCookieFetch = 0;
      return res.status(503).json({ error: "Bot protection triggered" });
    }

    const lookupParsed = parseFlightResponse(lookupResult);
    const character = lookupParsed["1"]?.character;
    const characterIdx = character?.characterIdx;

    if (!characterIdx) {
      return res.status(404).json({ error: "Character not found", raw: lookupResult.substring(0, 300) });
    }

    const baseUrl = `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection`;
    const collectionResult = curlPost(baseUrl, ACTION_COLLECTION, `[${characterIdx}]`);

    console.log("Collection response:", collectionResult.substring(0, 200));

    if (collectionResult.includes("Vercel Security Checkpoint")) {
      lastCookieFetch = 0;
      return res.status(503).json({ error: "Bot protection triggered" });
    }

    const collectionParsed = parseFlightResponse(collectionResult);
    const collection = collectionParsed["1"];

    res.json({ character, collection });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3001, () => console.log("Running"));