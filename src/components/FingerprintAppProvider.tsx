import { FingerprintContext, FingerprintProvider } from "@fingerprint/react";
import type { ReactNode } from "react";

export function FingerprintAppProvider({ children }: { children: ReactNode }) {
  const isTest = typeof process !== "undefined" && process.env?.["NODE_ENV"] === "test";
  const apiKey = !isTest
    ? (import.meta.env["VITE_FINGERPRINT_PUBLIC_API_KEY"] as string | undefined)?.trim()
    : undefined;

  // If no public API key is provided (e.g. in test suites or simulated local dev),
  // provide a fallback FingerprintContext so useVisitorData() does not throw.
  if (!apiKey) {
    return (
      <FingerprintContext.Provider
        value={{
          getVisitorData: async () => ({
            event_id: "mock_fp_event",
            visitor_id: "mock_fp_visitor",
            sealed_result: null,
          }),
        }}
      >
        {children}
      </FingerprintContext.Provider>
    );
  }

  return (
    <FingerprintProvider apiKey={apiKey} region="ap">
      {children}
    </FingerprintProvider>
  );
}
