/**
 * Help > About the team: who builds ROZOOM and how. The same four rows and seven lines are
 * published on rozoom.app, so a change here is a change there too.
 */

export type TeamMember = {
  name: string;
  role: string;
  /** Profile pages; absent for a contributor without a public profile to link. */
  github?: string;
  linkedin?: string;
};

export const TEAM_MEMBERS: readonly TeamMember[] = [
  {
    name: "Stanislav Ponomaryov",
    role: "Senior Full Stack Developer",
    github: "https://github.com/StasPonomaryov",
    linkedin: "https://www.linkedin.com/in/stasponomaryov/",
  },
  {
    name: "Yurii Pozhar",
    role: "Cloud and Kubernetes Engineer, Solution Architect",
    github: "https://github.com/udawpk",
    linkedin: "https://www.linkedin.com/in/yurii-pozhar/",
  },
  {
    name: "Kostiantyn Nesterenko",
    role: "Full Stack Developer, Solution Architect",
    github: "https://github.com/aveeday",
    linkedin: "https://www.linkedin.com/in/kstn/",
  },
  {
    name: "Claude (Anthropic)",
    role: "Code review and security checks",
  },
];

export type CorePrinciple = { title: string; line: string };

/** One line per principle of PHILOSOPHY.md, section Core principles, in its order. */
export const CORE_PRINCIPLES: readonly CorePrinciple[] = [
  {
    title: "Bundled tools",
    line: "kubectl and Helm ship in every build, the other CLIs in the full-offline build; ROZOOM runs its bundled copies for its own work.",
  },
  {
    title: "Fleet-first",
    line: "Every cluster on one dashboard, with health, alerts and scores compared across the fleet at a glance.",
  },
  {
    title: "Read-heavy, write-careful",
    line: "Reads run in the background; a write needs your click, and a destructive one names the command before it runs.",
  },
  {
    title: "Graceful degradation",
    line: "No metrics-server, no Prometheus, a cluster that does not answer: ROZOOM says what is missing and shows what it has.",
  },
  {
    title: "No cloud lock-in",
    line: "Any Kubernetes cluster, from minikube to the managed clouds; cloud features are detected, never required.",
  },
  {
    title: "Local-first",
    line: "Cluster data and preferences stay on your machine; telemetry is opt-in and never carries cluster contents.",
  },
  {
    title: "Transparency",
    line: "Switch on Show kubectl commands and every write shows its command with the time and a Copy button.",
  },
];

export const PHILOSOPHY_URL =
  "https://github.com/ceh13-community/rozoom/blob/main/dashboard-app/PHILOSOPHY.md";
