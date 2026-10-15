#!/usr/bin/env node
const fs = require("node:fs");

const path = process.argv[2] || (process.env.HOME + "/.clasprc.json");
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const DEFAULT_ID = "1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com";

function credential() {
  if (raw.tokens && raw.tokens.default) return { format: "V3_DEFAULT", value: raw.tokens.default };
  if (raw.token && raw.oauth2ClientSettings) {
    return { format: "V1_LOCAL", value: Object.assign({}, raw.token, {client_id: raw.oauth2ClientSettings.clientId}) };
  }
  if (raw.access_token || raw.refresh_token) {
    return { format: "V1_GLOBAL", value: {client_id: DEFAULT_ID, refresh_token: raw.refresh_token, access_token: raw.access_token} };
  }
  return { format: "UNKNOWN", value: {} };
}

const found = credential();
const value = found.value;
const clientId = typeof value.client_id === "string" ? value.client_id : "";
const match = /^([0-9]+)-/.exec(clientId);
const projectNumber = match ? match[1] : null;
const clientType = clientId === DEFAULT_ID ? "GOOGLE_PROVIDED_CLASP" : (clientId ? "USER_PROVIDED" : "UNKNOWN");
const result = {
  ok: Boolean(clientId && value.refresh_token),
  credentialFormat: found.format,
  clientType,
  oauthProjectNumber: projectNumber,
  refreshTokenConfigured: Boolean(value.refresh_token),
  accessTokenConfigured: Boolean(value.access_token)
};
process.stdout.write(JSON.stringify(result));
