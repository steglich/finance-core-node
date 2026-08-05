/**
 * Port through which the finance context learns that a transaction was created
 * by settling a charge or a payable.
 *
 * Those transactions are the visible half of an obligation that was already
 * settled: editing one would leave the charge or payable saying something the
 * ledger contradicts. The check lives behind an interface because charges and
 * payables belong to `pagamentos`, which depends on `financeiro` and never the
 * other way round.
 */
export interface SettlementOriginChecker {
  /**
   * Whether the transaction was produced by a charge receipt or a payable
   * settlement.
   */
  isFromSettlement(companyId: string, transactionId: string): Promise<boolean>;
}

/**
 * Provider used before the payments context is wired in: nothing is settled.
 */
export const NO_SETTLEMENT_ORIGIN: SettlementOriginChecker = {
  async isFromSettlement(): Promise<boolean> {
    return false;
  },
};
