const path = require("path");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Health check for Render
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// Static site
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

// Fallback to the home page
app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Rocks and Relics running on http://localhost:${PORT}`);
});
