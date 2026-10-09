import config from "../../eslint.config.mjs";
export default [
  ...config,
  { ignores: ["android/**", "ios/**", ".expo/**", "node_modules/**"] },
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];
