import { readFile, writeFile } from "node:fs/promises";

const required = ["D1_DATABASE_ID"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID;
config.vars.ACCESS_TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN || "access-not-configured.invalid";
config.vars.ACCESS_AUD = process.env.ACCESS_AUD || "access-not-configured";
if (process.env.PUBLIC_BASE_URL) config.vars.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
config.workers_dev = !process.env.CUSTOM_DOMAIN;
config.preview_urls = false;

if (process.env.CUSTOM_DOMAIN) {
  config.routes = [{ pattern: process.env.CUSTOM_DOMAIN, custom_domain: true }];
}

await writeFile("wrangler.production.jsonc", `${JSON.stringify(config, null, 2)}\n`);
