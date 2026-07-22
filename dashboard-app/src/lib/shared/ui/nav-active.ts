/**
 * Single active-state token for navigation chrome (Nav #6).
 *
 * Sidebar toggles, workbench tabs and the YAML breadcrumb used to mix
 * emerald and sky for their "active" look. Every nav surface now derives
 * the active state from the theme's --primary variable, so retuning the
 * color happens here (or in the theme) and nowhere else.
 */
export const NAV_ACTIVE_CLASS = "bg-primary/15 text-primary";

export const NAV_ACTIVE_HOVER_CLASS = "hover:bg-primary/25";

/** Text-only variant for surfaces that keep their own background (breadcrumb). */
export const NAV_ACTIVE_TEXT_CLASS = "text-primary";
