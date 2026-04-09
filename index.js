const express = require("express");
const cors = require("cors");
const { execSync } = require("child_process");

const app = express();
app.use(cors());

const NEXT_ACTION = "40feefff897c3700a0ecac9b5f903cf96e7293d9e5";
const ROUTER_STATE = "%5B%22%22%2C%7B%22children%22%3A%5B%22(routes)%22%2C%7B%22children%22%3A%5B%22(with-layout)%22%2C%7B%22children%22%3A%5B%22(marketing)%22%2C%7B%22children%22%3A%5B%22character%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D";

app.get("/collection", (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name" });

  const url = `https://www.neogames.online/character?name=${encodeURIComponent(name)}&menu=information&tab=collection`;

  try {
    const result = execSync(`curl_chrome116 \
      -s \
      -X POST \
      -H "accept: text/x-component" \
      -H "content-type: text/plain;charset=UTF-8" \
      -H "next-action: ${NEXT_ACTION}" \
      -H "next-router-state-tree: ${ROUTER_STATE}" \
      -H "origin: https://www.neogames.online" \
      -H "referer: ${url}" \
      --data-raw "[103747]" \
      "${url}"`, 
      { timeout: 30000 }
    ).toString();

    console.log("Response preview:", result.substring(0, 200));

    if (result.includes("Vercel Security Checkpoint")) {
      return res.status(503).json({ error: "Still blocked" });
    }

    const parsed = {};
    for (const line of result.split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const id = line.slice(0, colonIdx);
      const raw = line.slice(colonIdx + 1);
      try { parsed[id] = JSON.parse(raw); }
      catch { /* skip */ }
    }

    const payload = parsed["1"];
    if (!payload?.data || !payload?.values) {
      return res.status(500).json({ error: "Collection payload not found", raw: result.substring(0, 500) });
    }

    res.json(payload);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3001, () => console.log("Running"));