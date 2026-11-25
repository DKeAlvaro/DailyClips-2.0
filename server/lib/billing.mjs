// Stripe subscription for the Pro tier. Filled in with phase 3; until then Pro is simply off.
export function createBilling() {
  return {
    publicConfig: () => ({ enabled: false }),
    cancelNow: async () => {},
    routes: () => {},
  };
}
