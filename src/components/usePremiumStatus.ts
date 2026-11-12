"use client";

type PremiumState = {
  loading: boolean;
  unlocked: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number;
};

/**
 * Premium charging is currently paused. Keep this single access hook so the
 * previous account data can be reused if a paid tier is reconsidered later,
 * while every current user receives the complete feature set.
 */
export default function usePremiumStatus(): PremiumState {
  return {
    loading: false,
    unlocked: true,
    trialActive: false,
    trialEndsAt: null,
    trialDaysLeft: 0,
  };
}
