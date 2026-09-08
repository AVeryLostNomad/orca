export async function seedDevActivityFixtureIfRequested(): Promise<void> {
  if (
    !import.meta.env.DEV ||
    String(import.meta.env.VITE_ACTIVITY_DEV_FIXTURE).toLowerCase() !== 'true'
  ) {
    return
  }
  // Why: the development-only fixture must remain outside production startup chunks.
  const { seedDevActivityFixture } = await import('../components/activity/dev-activity-fixture')
  seedDevActivityFixture()
}
