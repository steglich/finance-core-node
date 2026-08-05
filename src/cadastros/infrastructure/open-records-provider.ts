/**
 * Port through which the registry context learns whether a person still has
 * unsettled records, without importing anything from `pagamentos`.
 *
 * The dependency direction is `cadastros` <- `financeiro` <- `pagamentos`, so
 * the adapter that wires the charge and payable repositories into this
 * interface is assembled in the composition root, not here.
 */
export interface OpenRecordsProvider {
  /**
   * Charges of the person that are neither paid nor cancelled.
   */
  countOpenCharges(companyId: string, personId: string): Promise<number>;

  /**
   * Payables of the person that are neither paid nor cancelled.
   */
  countOpenPayables(companyId: string, personId: string): Promise<number>;
}

/**
 * Provider used before the payments context is wired in: nothing is open.
 */
export const NO_OPEN_RECORDS: OpenRecordsProvider = {
  async countOpenCharges(): Promise<number> {
    return 0;
  },
  async countOpenPayables(): Promise<number> {
    return 0;
  },
};
