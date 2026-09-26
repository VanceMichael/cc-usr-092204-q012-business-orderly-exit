// 债权申报登记：同一债权人就同一债权依据（合同、判决、工资单等）重复申报的，
// 只登记一次、只计一次金额，不得多占清偿份额。
export function claimKey(claim) {
  return `${claim.creditorId}::${claim.basis}`;
}

// claims 为 Map(key -> claim)。返回 { claim, duplicate }。
export function registerClaim(claims, claim) {
  const key = claimKey(claim);
  if (claims.has(key)) {
    return { claim: claims.get(key), duplicate: true };
  }
  const record = { ...claim, status: "filed" };
  claims.set(key, record);
  return { claim: record, duplicate: false };
}

export function withdrawClaim(claims, claimId) {
  for (const claim of claims.values()) {
    if (claim.claimId === claimId) claim.status = "withdrawn";
  }
}

export function openClaims(claims) {
  return [...claims.values()].filter((c) => c.status === "filed");
}

export function recognizedTotal(claims) {
  return openClaims(claims).reduce((sum, c) => sum + c.amount, 0);
}
