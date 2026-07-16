import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const EXPECTED_VERSION = "4.2.0";
const EXPECTED_PATCH_SHA256 =
  "e6ba0b5776bcb208b71fc4580187627a6516a537677f713fe418292eb9d1819d";

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
  "utf8",
);
// Git may materialize this reviewed text patch with CRLF on Windows and LF on
// Linux. Hash canonical LF content so the invariant checks the patch itself,
// not the runner's checkout convention.
const canonicalPatch = patch.replace(/\r\n/gu, "\n");
const patchSha256 = createHash("sha256").update(canonicalPatch).digest("hex");
if (patchSha256 !== EXPECTED_PATCH_SHA256) {
  throw new Error(
    "The pinned tldraw editor patch changed or disappeared. Obtain explicit approval and update the reviewed hash deliberately.",
  );
}

console.log(`Verified tldraw ${EXPECTED_VERSION} and the reviewed editor patch.`);
