/**
 * Studio profiles and the profile × phase → behaviour resolution.
 *
 * Profiles tune intensity only. They never move authority: the Designer engine
 * owns subjective visual direction, the UX engine owns deterministic
 * validation, and Studio owns orchestration — in every profile.
 */

export type ProfileId = "balanced" | "design-first" | "ux-first";
export type UxLevel = "off" | "lite" | "strict";
export type Exploration = "low" | "normal" | "high";
export type PhaseId = "explore" | "build" | "review" | "audit";
export type SessionPhase = PhaseId | "idle";

export interface Profile {
  id: ProfileId;
  label: string;
  designer: {
    exploration: Exploration;
    referenceStudy: boolean;
    visualReviews: number;
    repairLoops: number;
  };
  ux: {
    duringBuild: UxLevel;
    finalAudit: "strict";
  };
}

export const PROFILE_IDS: ProfileId[] = ["balanced", "design-first", "ux-first"];

export const PROFILES: Record<ProfileId, Profile> = {
  balanced: {
    id: "balanced",
    label: "Balanced",
    designer: { exploration: "normal", referenceStudy: true, visualReviews: 2, repairLoops: 1 },
    ux: { duringBuild: "lite", finalAudit: "strict" },
  },
  "design-first": {
    id: "design-first",
    label: "Design-First",
    designer: { exploration: "high", referenceStudy: true, visualReviews: 3, repairLoops: 2 },
    ux: { duringBuild: "lite", finalAudit: "strict" },
  },
  "ux-first": {
    id: "ux-first",
    label: "UX-First",
    designer: { exploration: "low", referenceStudy: true, visualReviews: 1, repairLoops: 1 },
    ux: { duringBuild: "strict", finalAudit: "strict" },
  },
};

export const DEFAULT_PROFILE: ProfileId = "balanced";

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && (PROFILE_IDS as string[]).includes(value);
}

export function isPhaseId(value: unknown): value is PhaseId {
  return typeof value === "string" && (["explore", "build", "review", "audit"] as string[]).includes(value);
}

export function isUxLevel(value: unknown): value is UxLevel {
  return typeof value === "string" && (["off", "lite", "strict"] as string[]).includes(value);
}

/** How hard each engine runs, and whether the phase can block. */
export interface PhaseBehavior {
  phase: PhaseId;
  designer: "active" | "support";
  ux: UxLevel;
  blocking: boolean;
  /** Short bullets shown by `/studio` and `/studio <phase>` — never internal plumbing. */
  plan: string[];
}

export function behaviorFor(profile: Profile, phase: PhaseId): PhaseBehavior {
  const { designer, ux } = profile;
  const reviewCount = designer.visualReviews;

  switch (phase) {
    case "explore":
      return {
        phase,
        designer: "active",
        ux: profile.id === "ux-first" ? "lite" : "off",
        blocking: false,
        plan: [
          "Designer: high weight on concept, hierarchy, art direction, references, type and motion direction",
          `Designer: exploration ${designer.exploration}, reference study ${designer.referenceStudy ? "on" : "off"}`,
          "Pi UX: quiet — do not tune the concept for audit scores yet",
          "Output: a direction, plus a drafted DESIGN.md when there is something real to pin down",
        ],
      };
    case "build":
      return {
        phase,
        designer: "support",
        ux: ux.duringBuild,
        blocking: ux.duringBuild === "strict",
        plan: [
          "Read project context and DESIGN.md before writing UI",
          "Reuse existing components and tokens; do not invent a second design system",
          `Pi UX: ${ux.duringBuild} guardrails${ux.duringBuild === "strict" ? " — blocking" : " — advisory"}`,
          "Ship states: default, hover, focus-visible, active, disabled, plus loading/empty/error where relevant",
        ],
      };
    case "review":
      return {
        phase,
        designer: "active",
        ux: "lite",
        blocking: false,
        plan: [
          "Render the real UI and capture screenshots before judging it",
          `Designer: ${reviewCount} visual review pass${reviewCount === 1 ? "" : "es"}, at most ${designer.repairLoops} repair loop${designer.repairLoops === 1 ? "" : "s"}`,
          "Critique: hierarchy, typography, whitespace, density, alignment, unclear primary action, generic-AI tells",
          "Compare against DESIGN.md; fix the highest-impact issues, then re-render",
        ],
      };
    case "audit":
      return {
        phase,
        designer: "support",
        ux: ux.finalAudit,
        blocking: true,
        plan: [
          "UX: strict deterministic audit — contrast/APCA, tokens, interaction states, reduced motion, slop tells",
          "UX: DESIGN.md compliance, then a final visual inspection",
          "Designer: one last pass for craft, not for new concepts",
          "Blocking: do not call the screen done while genuine failures remain",
        ],
      };
  }
}
