const assert = require("assert/strict");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "driftpost-server.js")],
    env: { ...process.env, DRIFTPOST_API_URL: "https://driftpost-production.up.railway.app" },
  });
  const client = new Client({ name: "driftpost-mcp-smoke", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    for (const name of ["health", "list_accounts", "generate_captions", "prepare_video_post", "publish_confirmed_video", "wait_for_publish"]) {
      assert(names.has(name), `MCP server is missing tool ${name}`);
    }
    const publish = tools.find((tool) => tool.name === "publish_confirmed_video");
    assert.equal(publish.inputSchema.required.includes("approval_phrase"), true, "publishing must require an explicit approval phrase");
    assert.equal(publish.inputSchema.required.includes("preview_id"), true, "publishing must require a prepared preview");
    const health = await client.callTool({ name: "health", arguments: {} });
    assert.equal(health.isError, undefined, "Driftpost health call should succeed");
    console.log("Driftpost MCP smoke: 6 tools registered, publish approval guard present, live health reachable.");
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
