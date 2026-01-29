import profiles from "./style-profiles.json";

export type StyleProfile = {
  key: string;
  label: string;
  tags: string[];
};

export const STYLE_PROFILES: StyleProfile[] = profiles;

export const STYLE_PROFILE_LABELS: Record<string, string> = Object.fromEntries(
  STYLE_PROFILES.map((profile) => [profile.key, profile.label]),
);
