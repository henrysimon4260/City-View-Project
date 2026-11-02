import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
mkdirSync(publicDir, { recursive: true });
cpSync(resolve(root, "node_modules/three/examples/jsm/libs/draco"), resolve(publicDir, "draco"), {
  recursive: true,
});
cpSync(resolve(root, "node_modules/three/examples/jsm/libs/basis"), resolve(publicDir, "basis"), {
  recursive: true,
});
