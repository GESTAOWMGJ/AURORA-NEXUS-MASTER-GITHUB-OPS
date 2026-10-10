// JFN-AUD-FAT-001: operações monetárias em centavos inteiros; nunca glosa automática.
export function cents(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw new Error('INVALID_CENTS');
  return value;
}
export function difference(expected, observed) {
  expected = cents(expected); observed = cents(observed);
  if (expected === null || observed === null) return { state: 'MISSING', deltaCents: null };
  const deltaCents = expected - observed;
  cents(deltaCents);
  return { state: deltaCents === 0 ? 'MATCH' : 'DIVERGENCE', deltaCents };
}
export function compareReply(questionedCents, acceptedExplanationCents, evidenceValidated) {
  const questioned = cents(questionedCents), accepted = cents(acceptedExplanationCents);
  if (questioned === null || accepted === null || evidenceValidated !== true) {
    return { state: 'OPEN', residualCents: questioned, needsEvidence: true };
  }
  if (questioned < 0 || accepted < 0 || accepted > questioned) throw new Error('INVALID_EXPLANATION');
  const residualCents = questioned - accepted;
  return { state: residualCents === 0 ? 'READY_FOR_HUMAN_VALIDATION' : 'OPEN', residualCents, needsEvidence: false };
}
export function proposeClosing({ independentBlockers, openFindings, evidenceComplete, humanApproved }) {
  if (!Array.isArray(independentBlockers) || !Number.isSafeInteger(openFindings) || openFindings < 0 ||
      typeof evidenceComplete !== 'boolean' || typeof humanApproved !== 'boolean') throw new Error('INVALID_CLOSING_INPUT');
  const status = independentBlockers.length ? 'BLOCKED' : !humanApproved ? 'AWAITING_HUMAN_REVIEW' :
    openFindings > 0 || !evidenceComplete ? 'MANAGERIAL_WITH_RESERVATIONS' : 'MANAGERIAL_COMPLETE';
  return { status, openFindings, paymentsAuthorized: false, findingsAutomaticallyClosed: false };
}
