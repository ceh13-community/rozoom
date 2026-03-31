import "@testing-library/jest-dom";
import { vi } from "vitest";

Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy");
vi.mock("@/lib/shared");
vi.mock("@sentry/sveltekit");
