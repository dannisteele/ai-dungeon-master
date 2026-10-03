/**
 * Whether skipping `characterId` still leaves someone else active and not-yet-skipped to act
 * this round. Mirrors the server's turns.ts `skip` guard (`stillIn.length === 0` throws
 * "Someone has to act this round."), so the client never offers a skip button the server would
 * refuse.
 */
export function canSkipAlone(activeIds: number[], skippedIds: number[], characterId: number): boolean {
  return activeIds.some((a) => a !== characterId && !skippedIds.includes(a));
}
