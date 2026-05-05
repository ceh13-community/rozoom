import { dev } from "$app/environment";
import { env } from "$env/dynamic/public";
import { error } from "@sveltejs/kit";

export function load() {
  const isStaging = env.PUBLIC_APP_ENV === "staging";
  if (!dev && !isStaging) {
    error(404, "Not found");
  }
}
