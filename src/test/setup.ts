import "@testing-library/jest-dom/vitest";

if (process.env["RUN_PG_INTEGRATION"] !== "1") {
  delete process.env["FINGERPRINT_SECRET_API_KEY"];
  delete process.env["VITE_FINGERPRINT_PUBLIC_API_KEY"];
  delete process.env["VITE_VOTE_API_URL"];
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: () => {},
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
