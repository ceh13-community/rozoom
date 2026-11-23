import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AboutTeamDialog from "./about-team-dialog.svelte";
import { CORE_PRINCIPLES, PHILOSOPHY_URL, TEAM_MEMBERS } from "../model/team";

const openExternalUrl = vi.hoisted(() => vi.fn(async (_url: string) => undefined));
vi.mock("$shared/api/in-app-browser", () => ({ openExternalUrl }));

describe("Help > About the team", () => {
  it("lists every member with the role, and the seven principles with the link to the full text", () => {
    const view = render(AboutTeamDialog, { props: { open: true, onClose: vi.fn() } });

    const members = view.getAllByTestId("team-member");
    expect(members).toHaveLength(TEAM_MEMBERS.length);
    for (const member of TEAM_MEMBERS) {
      expect(view.getByText(member.name)).toBeInTheDocument();
      expect(view.getByText(member.role)).toBeInTheDocument();
    }
    const principles = view.getAllByTestId("core-principle");
    expect(principles).toHaveLength(CORE_PRINCIPLES.length);
    for (const principle of CORE_PRINCIPLES) {
      expect(view.getByText(`${principle.title}.`)).toBeInTheDocument();
      expect(view.getByText(principle.line)).toBeInTheDocument();
    }
    expect(view.getByRole("button", { name: "Read the full philosophy" })).toBeInTheDocument();
  });

  it("opens profiles and the philosophy in the system browser", async () => {
    openExternalUrl.mockClear();
    const view = render(AboutTeamDialog, { props: { open: true, onClose: vi.fn() } });

    await fireEvent.click(
      view.getByRole("button", { name: "GitHub profile of Stanislav Ponomaryov" }),
    );
    await fireEvent.click(view.getByRole("button", { name: "LinkedIn profile of Yurii Pozhar" }));
    await fireEvent.click(view.getByRole("button", { name: "Read the full philosophy" }));

    expect(openExternalUrl.mock.calls.map(([url]) => url)).toEqual([
      "https://github.com/StasPonomaryov",
      "https://www.linkedin.com/in/yurii-pozhar/",
      PHILOSOPHY_URL,
    ]);
  });

  it("the Claude row has no links, every human has GitHub and LinkedIn", () => {
    const view = render(AboutTeamDialog, { props: { open: true, onClose: vi.fn() } });

    expect(view.queryByRole("button", { name: /profile of Claude/ })).toBeNull();
    for (const member of TEAM_MEMBERS.filter((m) => m.name !== "Claude (Anthropic)")) {
      expect(view.getByRole("button", { name: `GitHub profile of ${member.name}` })).toBeTruthy();
      expect(view.getByRole("button", { name: `LinkedIn profile of ${member.name}` })).toBeTruthy();
    }
  });

  it("closing the sheet reports back to the owner", async () => {
    const onClose = vi.fn();
    const view = render(AboutTeamDialog, { props: { open: true, onClose } });
    await fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
