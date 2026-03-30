import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveWithFallback,
  type MetricsResolver,
  type ResolverResult,
} from "./node-metrics.resolver";

describe("resolveWithFallback", () => {
  const mockClusterId = "test-cluster-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type TestData = { value: number };

  const createMockResolver = (
    id: string,
    isAvailable: boolean,
    result: ResolverResult<TestData> | Error,
  ): MetricsResolver<TestData> => ({
    id,
    title: `${id} resolver`,
    isAvailable: vi.fn().mockResolvedValue(isAvailable),
    resolve: vi.fn().mockImplementation(() => {
      if (result instanceof Error) throw result;
      return Promise.resolve(result);
    }),
  });

  describe("successful resolution", () => {
    it("should return result from first available resolver", async () => {
      const resolver1 = createMockResolver("resolver-1", true, {
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      expect(resolver1.isAvailable).toHaveBeenCalledWith(mockClusterId);
      expect(resolver1.resolve).toHaveBeenCalledWith(mockClusterId);
      expect(resolver2.isAvailable).not.toHaveBeenCalled();
    });

    it("should try next resolver when first is not available", async () => {
      const resolver1 = createMockResolver("resolver-1", false, {
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      expect(resolver1.isAvailable).toHaveBeenCalled();
      expect(resolver1.resolve).not.toHaveBeenCalled();
      expect(resolver2.isAvailable).toHaveBeenCalled();
      expect(resolver2.resolve).toHaveBeenCalled();
    });

    it("should try next resolver when first returns unsuccessful result", async () => {
      const resolver1 = createMockResolver("resolver-1", true, {
        success: false,
        source: "resolver-1",
        error: "Failed to fetch",
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      expect(resolver1.resolve).toHaveBeenCalled();
      expect(resolver2.resolve).toHaveBeenCalled();
    });

    it("should work with single resolver", async () => {
      const resolver = createMockResolver("only-resolver", true, {
        success: true,
        source: "only-resolver",
        data: { value: 42 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: true,
        source: "only-resolver",
        data: { value: 42 },
      });
    });

    it("should stop at first successful result", async () => {
      const resolver1 = createMockResolver("resolver-1", false, {
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const resolver3 = createMockResolver("resolver-3", true, {
        success: true,
        source: "resolver-3",
        data: { value: 300 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2, resolver3]);

      expect(result.success).toBe(true);
      expect(result.source).toBe("resolver-2");
      expect(resolver3.isAvailable).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should return error when resolver throws Error", async () => {
      const error = new Error("Network failure");
      const resolver = createMockResolver("failing-resolver", true, error);

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: false,
        source: "failing-resolver",
        error: "Network failure",
      });
    });

    it("should return error when resolver throws non-Error", async () => {
      const resolver: MetricsResolver<TestData> = {
        id: "throwing-resolver",
        title: "Throwing resolver",
        isAvailable: vi.fn().mockResolvedValue(true),
        resolve: vi.fn().mockRejectedValue("String error"),
      };

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: false,
        source: "throwing-resolver",
        error: "Unknown error",
      });
    });

    it("should return error when isAvailable throws", async () => {
      const resolver: MetricsResolver<TestData> = {
        id: "availability-error",
        title: "Availability error",
        isAvailable: vi.fn().mockRejectedValue(new Error("Connection timeout")),
        resolve: vi.fn(),
      };

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: false,
        source: "availability-error",
        error: "Connection timeout",
      });

      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it("should return error from first failing resolver and not try others", async () => {
      const resolver1: MetricsResolver<TestData> = {
        id: "resolver-1",
        title: "Resolver 1",
        isAvailable: vi.fn().mockResolvedValue(true),
        resolve: vi.fn().mockRejectedValue(new Error("First error")),
      };

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: false,
        source: "resolver-1",
        error: "First error",
      });

      expect(resolver2.isAvailable).not.toHaveBeenCalled();
    });
  });

  describe("no available resolvers", () => {
    it("should return error when resolver list is empty", async () => {
      const result = await resolveWithFallback(mockClusterId, []);

      expect(result).toEqual({
        success: false,
        source: "none",
        error: "No resolver available",
      });
    });

    it("should return error when all resolvers are unavailable", async () => {
      const resolver1 = createMockResolver("resolver-1", false, {
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      const resolver2 = createMockResolver("resolver-2", false, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: false,
        source: "none",
        error: "No resolver available",
      });

      expect(resolver1.resolve).not.toHaveBeenCalled();
      expect(resolver2.resolve).not.toHaveBeenCalled();
    });

    it("should return error when all resolvers return unsuccessful results", async () => {
      const resolver1 = createMockResolver("resolver-1", true, {
        success: false,
        source: "resolver-1",
        error: "Error 1",
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: false,
        source: "resolver-2",
        error: "Error 2",
      });

      const result = await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(result).toEqual({
        success: false,
        source: "none",
        error: "No resolver available",
      });
    });
  });

  describe("resolver order", () => {
    it("should try resolvers in order", async () => {
      const callOrder: string[] = [];

      const resolver1: MetricsResolver<TestData> = {
        id: "resolver-1",
        title: "Resolver 1",
        isAvailable: vi.fn().mockImplementation(async () => {
          callOrder.push("resolver-1-isAvailable");
          return false;
        }),
        resolve: vi.fn(),
      };

      const resolver2: MetricsResolver<TestData> = {
        id: "resolver-2",
        title: "Resolver 2",
        isAvailable: vi.fn().mockImplementation(async () => {
          callOrder.push("resolver-2-isAvailable");
          return true;
        }),
        resolve: vi.fn().mockImplementation(async () => {
          callOrder.push("resolver-2-resolve");
          return { success: true, source: "resolver-2", data: { value: 200 } };
        }),
      };

      const resolver3: MetricsResolver<TestData> = {
        id: "resolver-3",
        title: "Resolver 3",
        isAvailable: vi.fn().mockImplementation(async () => {
          callOrder.push("resolver-3-isAvailable");
          return true;
        }),
        resolve: vi.fn(),
      };

      await resolveWithFallback(mockClusterId, [resolver1, resolver2, resolver3]);

      expect(callOrder).toEqual([
        "resolver-1-isAvailable",
        "resolver-2-isAvailable",
        "resolver-2-resolve",
      ]);
    });
  });

  describe("clusterId propagation", () => {
    it("should pass clusterId to isAvailable", async () => {
      const resolver = createMockResolver("resolver", true, {
        success: true,
        source: "resolver",
        data: { value: 100 },
      });

      await resolveWithFallback(mockClusterId, [resolver]);

      expect(resolver.isAvailable).toHaveBeenCalledWith(mockClusterId);
    });

    it("should pass clusterId to resolve", async () => {
      const resolver = createMockResolver("resolver", true, {
        success: true,
        source: "resolver",
        data: { value: 100 },
      });

      await resolveWithFallback(mockClusterId, [resolver]);

      expect(resolver.resolve).toHaveBeenCalledWith(mockClusterId);
    });

    it("should use same clusterId for all resolvers", async () => {
      const resolver1 = createMockResolver("resolver-1", false, {
        success: true,
        source: "resolver-1",
        data: { value: 100 },
      });

      const resolver2 = createMockResolver("resolver-2", true, {
        success: true,
        source: "resolver-2",
        data: { value: 200 },
      });

      await resolveWithFallback(mockClusterId, [resolver1, resolver2]);

      expect(resolver1.isAvailable).toHaveBeenCalledWith(mockClusterId);
      expect(resolver2.isAvailable).toHaveBeenCalledWith(mockClusterId);
      expect(resolver2.resolve).toHaveBeenCalledWith(mockClusterId);
    });
  });

  describe("edge cases", () => {
    it("should handle resolver with null data", async () => {
      const resolver: MetricsResolver<null> = {
        id: "null-resolver",
        title: "Null resolver",
        isAvailable: vi.fn().mockResolvedValue(true),
        resolve: vi.fn().mockResolvedValue({
          success: true,
          source: "null-resolver",
          data: null,
        }),
      };

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: true,
        source: "null-resolver",
        data: null,
      });
    });

    it("should handle resolver with complex data structure", async () => {
      type ComplexData = {
        items: Array<{ name: string; value: number }>;
        metadata: { count: number };
      };

      const complexData: ComplexData = {
        items: [
          { name: "item1", value: 10 },
          { name: "item2", value: 20 },
        ],
        metadata: { count: 2 },
      };

      const resolver: MetricsResolver<ComplexData> = {
        id: "complex-resolver",
        title: "Complex resolver",
        isAvailable: vi.fn().mockResolvedValue(true),
        resolve: vi.fn().mockResolvedValue({
          success: true,
          source: "complex-resolver",
          data: complexData,
        }),
      };

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(complexData);
      }
    });

    it("should handle empty error message", async () => {
      const resolver: MetricsResolver<TestData> = {
        id: "empty-error",
        title: "Empty error",
        isAvailable: vi.fn().mockResolvedValue(true),
        resolve: vi.fn().mockRejectedValue(new Error("")),
      };

      const result = await resolveWithFallback(mockClusterId, [resolver]);

      expect(result).toEqual({
        success: false,
        source: "empty-error",
        error: "",
      });
    });
  });
});
