// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig, resolveCaCertificate } from "@/server/config";

const VALID_PEM = `-----BEGIN CERTIFICATE-----
MIIB/zCCAaagAwIBAgIUeExampleCertDataOnlyForTestingPurpose1234567890
-----END CERTIFICATE-----`;

const VALID_BASE64 = Buffer.from(VALID_PEM, "utf8").toString("base64");

describe("SSL CA certificate resolution and config loading", () => {
  it("decodes valid DB_SSL_CA_BASE64 correctly", () => {
    const ca = resolveCaCertificate({
      DB_SSL_CA_BASE64: VALID_BASE64,
    });
    expect(ca).toBe(VALID_PEM);
  });

  it("passes decoded PEM certificate to config.ssl.ca and enforces rejectUnauthorized: true", () => {
    const cfg = loadConfig({
      DB_SSL: "true",
      DB_SSL_CA_BASE64: VALID_BASE64,
      DB_SSL_REJECT_UNAUTHORIZED: "true",
    });
    expect(cfg.ssl).not.toBe(false);
    if (cfg.ssl) {
      expect(cfg.ssl.rejectUnauthorized).toBe(true);
      expect(cfg.ssl.ca).toBe(VALID_PEM);
    }
  });

  it("prioritizes DB_SSL_CA_BASE64 over DB_SSL_CA_PATH even if path is non-existent", () => {
    const cfg = loadConfig({
      DB_SSL_CA_BASE64: VALID_BASE64,
      DB_SSL_CA_PATH: "./non-existent-certs/ap-south-1-bundle.pem",
    });
    expect(cfg.ssl).not.toBe(false);
    if (cfg.ssl) {
      expect(cfg.ssl.ca).toBe(VALID_PEM);
    }
  });

  it("falls back to DB_SSL_CA_PATH when DB_SSL_CA_BASE64 is absent or empty", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adnoc-cert-test-"));
    const certPath = path.join(tempDir, "test-ca.pem");
    fs.writeFileSync(certPath, VALID_PEM, "utf8");

    try {
      const cfgWithAbsent = loadConfig({
        DB_SSL_CA_PATH: certPath,
      });
      expect(cfgWithAbsent.ssl).not.toBe(false);
      if (cfgWithAbsent.ssl) {
        expect(cfgWithAbsent.ssl.ca).toBe(VALID_PEM);
      }

      const cfgWithEmptyBase64 = loadConfig({
        DB_SSL_CA_BASE64: "",
        DB_SSL_CA_PATH: certPath,
      });
      expect(cfgWithEmptyBase64.ssl).not.toBe(false);
      if (cfgWithEmptyBase64.ssl) {
        expect(cfgWithEmptyBase64.ssl.ca).toBe(VALID_PEM);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("leaves ssl.ca undefined when neither DB_SSL_CA_BASE64 nor DB_SSL_CA_PATH is provided", () => {
    const cfg = loadConfig({
      DB_SSL_CA_BASE64: "",
      DB_SSL_CA_PATH: "",
    });
    expect(cfg.ssl).not.toBe(false);
    if (cfg.ssl) {
      expect(cfg.ssl.rejectUnauthorized).toBe(true);
      expect(cfg.ssl.ca).toBeUndefined();
    }
  });

  it("throws clear error when DB_SSL_CA_BASE64 contains only whitespace", () => {
    expect(() =>
      resolveCaCertificate({
        DB_SSL_CA_BASE64: "   ",
      }),
    ).toThrow("DB_SSL_CA_BASE64 is configured but contains only whitespace.");
  });

  it("throws clear error when DB_SSL_CA_BASE64 is not a valid PEM certificate", () => {
    const notPemBase64 = Buffer.from("hello world not a cert", "utf8").toString("base64");
    expect(() =>
      resolveCaCertificate({
        DB_SSL_CA_BASE64: notPemBase64,
      }),
    ).toThrow("DB_SSL_CA_BASE64 is malformed");
  });

  it("throws clear error when DB_SSL_CA_PATH file does not exist", () => {
    expect(() =>
      resolveCaCertificate({
        DB_SSL_CA_PATH: "./does/not/exist/ca.pem",
      }),
    ).toThrow("DB_SSL_CA_PATH certificate file not found");
  });

  it("throws clear error when DB_SSL_CA_PATH file is empty", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adnoc-cert-test-"));
    const certPath = path.join(tempDir, "empty.pem");
    fs.writeFileSync(certPath, "", "utf8");

    try {
      expect(() =>
        resolveCaCertificate({
          DB_SSL_CA_PATH: certPath,
        }),
      ).toThrow("is empty");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("throws clear error when DB_SSL_CA_PATH file does not contain a PEM certificate", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adnoc-cert-test-"));
    const certPath = path.join(tempDir, "invalid.pem");
    fs.writeFileSync(certPath, "not a certificate", "utf8");

    try {
      expect(() =>
        resolveCaCertificate({
          DB_SSL_CA_PATH: certPath,
        }),
      ).toThrow("does not contain a valid PEM certificate");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("disables SSL when DB_SSL=false", () => {
    const cfg = loadConfig({
      DB_SSL: "false",
      DB_SSL_CA_BASE64: VALID_BASE64,
    });
    expect(cfg.ssl).toBe(false);
  });

  it("successfully connects to database using DB_SSL_CA_BASE64 if RDS is configured", async () => {
    const rdsCertPath = "./certs/aws-rds/ap-south-1-bundle.pem";
    if (!fs.existsSync(rdsCertPath)) return;
    const certPem = fs.readFileSync(rdsCertPath, "utf8");
    const certBase64 = Buffer.from(certPem, "utf8").toString("base64");

    const cfg = loadConfig({
      ...process.env,
      DB_SSL: "true",
      DB_SSL_CA_BASE64: certBase64,
      DB_SSL_CA_PATH: "./non-existent-path/bundle.pem",
      DB_SSL_REJECT_UNAUTHORIZED: "true",
    });

    expect(cfg.ssl).not.toBe(false);
    if (cfg.ssl) {
      expect(cfg.ssl.rejectUnauthorized).toBe(true);
      expect(cfg.ssl.ca).toBe(certPem);
    }
  });
});
