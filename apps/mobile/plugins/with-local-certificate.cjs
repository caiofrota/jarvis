const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
function certificateConfig(host) {
  if (!host) return null;
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || new URL(`https://${host}`).hostname !== host.toLowerCase())
    throw new Error("JARVIS_LOCAL_TLS_HOST must be one hostname or IPv4 address.");
  return `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config>
  <domain-config cleartextTrafficPermitted="false"><domain includeSubdomains="false">${host}</domain><trust-anchors><certificates src="system" /><certificates src="user" /></trust-anchors></domain-config>
</network-security-config>
`;
}
module.exports = (config, { host = process.env.JARVIS_LOCAL_TLS_HOST ?? "" } = {}) => {
  const xml = certificateConfig(host);
  if (!xml) return config;
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    app.$["android:networkSecurityConfig"] = "@xml/jarvis_network_security";
    app.$["android:usesCleartextTraffic"] = "false";
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const directory = join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "jarvis_network_security.xml"), xml);
      return mod;
    },
  ]);
};
module.exports.certificateConfig = certificateConfig;
