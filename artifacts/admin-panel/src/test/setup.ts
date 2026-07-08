import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// recharts' ResponsiveContainer measures the DOM; jsdom reports 0×0. Stub a
// non-zero size so charts render children in component tests.
if (typeof window !== "undefined") {
  Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 400,
  });
  window.HTMLElement.prototype.scrollTo = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
