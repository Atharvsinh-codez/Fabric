import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const EXPECTED_VERSION = "4.2.0";
const EXPECTED_PATCH_SHA256 =
  "51f77b50cb74ec075a1cfba5199eec408d01256cf90e61f9016866a25379964e";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const declaredVersion = packageJson.dependencies?.tldraw;

if (declaredVersion !== EXPECTED_VERSION) {
  throw new Error(
    `tldraw must remain pinned exactly to ${EXPECTED_VERSION}; found ${String(declaredVersion)}.`,
  );
}

const installedPackage = JSON.parse(
  await readFile(new URL("../node_modules/tldraw/package.json", import.meta.url), "utf8"),
);
if (installedPackage.version !== EXPECTED_VERSION) {
  throw new Error(
    `Installed tldraw must be ${EXPECTED_VERSION}; found ${String(installedPackage.version)}.`,
  );
}

const patch = await readFile(
  new URL("../patches/@tldraw+editor+4.2.0.patch", import.meta.url),
);
const patchSha256 = createHash("sha256").update(patch).digest("hex");
if (patchSha256 !== EXPECTED_PATCH_SHA256) {
  throw new Error(
    "The pinned tldraw editor patch changed or disappeared. Obtain explicit approval and update the reviewed hash deliberately.",
  );
}

console.log(`Verified tldraw ${EXPECTED_VERSION} and the reviewed editor patch.`);
