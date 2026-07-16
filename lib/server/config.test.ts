import { describe, expect, it } from "vitest";

import { loadFabricServerConfig } from "./config";

describe("loadFabricServerConfig", () => {
  it("uses the single-origin production defaults", () => {
    expect(loadFabricServerConfig({ NODE_ENV: "production" })).toEqual({
      development: false,
      hostname: "0.0.0.0",
      port: 3_000,
    });
  });

  it("supports Next development mode on the same configured listener", () => {
    expect(
      loadFabricServerConfig({
        NODE_ENV: "development",
        FABRIC_HOST: "127.0.0.1",
        PORT: "4100",
      }),
    ).toEqual({
      development: true,
      hostname: "127.0.0.1",
      port: 4_100,
    });
  });

  it.each(["0", "65536", "3000.5", "not-a-port"])("rejects invalid PORT %s", (port) => {
    expect(() => loadFabricServerConfig({ NODE_ENV: "production", PORT: port })).toThrow(
      "PORT must be an integer between 1 and 65535.",
    );
  });

  it("rejects ambiguous runtime modes and malformed listener hosts", () => {
    expect(() => loadFabricServerConfig({ NODE_ENV: "test" })).toThrow(
      "NODE_ENV must be development or production",
    );
    expect(() =>
      loadFabricServerConfig({ NODE_ENV: "production", FABRIC_HOST: "https://localhost" }),
    ).toThrow("FABRIC_HOST must be a valid hostname or IP address.");
  });

  it("ignores the operating system HOSTNAME and binds safely by default", () => {
    expect(
      loadFabricServerConfig({ NODE_ENV: "production", HOSTNAME: "container-runtime-id" }),
    ).toMatchObject({ hostname: "0.0.0.0" });
  });
});
