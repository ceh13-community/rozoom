import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it } from "vitest";
import TextPromptHost from "./text-prompt-host.svelte";
import { requestText } from "$shared/lib/text-prompt.svelte";

describe("TextPromptHost", () => {
  it("resolves with the typed text on Enter", async () => {
    render(TextPromptHost);
    const answer = requestText({ title: "Rename cluster context", initialValue: "minikube" });
    await tick();
    const input = screen.getByRole("textbox", {
      name: "Rename cluster context",
    }) as HTMLInputElement;
    expect(input.value).toBe("minikube");
    await fireEvent.input(input, { target: { value: "lab" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    await expect(answer).resolves.toBe("lab");
    await tick();
    expect(screen.queryByTestId("text-prompt")).not.toBeInTheDocument();
  });

  it("resolves null on Cancel", async () => {
    render(TextPromptHost);
    const answer = requestText({ title: "Create group" });
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toBeNull();
  });

  it("blocks an empty answer unless allowed", async () => {
    render(TextPromptHost);
    const blocked = requestText({ title: "Add tag" });
    await tick();
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await blocked;

    const allowed = requestText({ title: "Set default namespace", allowEmpty: true });
    await tick();
    await fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await expect(allowed).resolves.toBe("");
  });
});
