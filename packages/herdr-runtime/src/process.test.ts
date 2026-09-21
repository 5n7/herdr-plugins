import { describe, expect, test } from "bun:test";
import { hostProcess } from "./process";

function errno(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe("hostProcess", () => {
  test("treats EPERM as evidence that the process exists", () => {
    const kill = process.kill;
    try {
      process.kill = () => {
        throw errno("EPERM");
      };
      expect(hostProcess.alive(123)).toBe(true);
    } finally {
      process.kill = kill;
    }
  });

  test("treats ESRCH as a dead process", () => {
    const kill = process.kill;
    try {
      process.kill = () => {
        throw errno("ESRCH");
      };
      expect(hostProcess.alive(123)).toBe(false);
    } finally {
      process.kill = kill;
    }
  });
});
