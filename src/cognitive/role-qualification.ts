/** Qualification comes from an actual successful role call, never a recurring paid probe. */
const observed = new Map<string, { fingerprint: string; at: string }>();
export function recordRoleQualification(role: string, fingerprint: string): void {
  observed.set(role, { fingerprint, at: new Date().toISOString() });
}
export function revokeRoleQualification(role: string, fingerprint: string): void {
  if (observed.get(role)?.fingerprint === fingerprint) observed.delete(role);
}
export function roleQualification(role: string, fingerprint: string): string | null {
  const value = observed.get(role);
  return value?.fingerprint === fingerprint ? value.at : null;
}
