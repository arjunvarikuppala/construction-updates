import { IPaymentProvider } from './types.js';
import { RazorpayXPayoutProvider } from './razorpayXProvider.js';

let activeProviderInstance: IPaymentProvider | null = null;

/**
 * RazorpayX Payouts Provider Factory
 * Returns the active RazorpayX Payouts provider for all new transfers.
 * The old legacy/mock provider has been completely removed from the active execution path.
 */
export function getPaymentProvider(): IPaymentProvider {
  if (activeProviderInstance) {
    return activeProviderInstance;
  }

  // Active payout provider is now RazorpayX Payouts
  activeProviderInstance = new RazorpayXPayoutProvider();
  return activeProviderInstance;
}

// Allows testing suite to inspect or reset provider
export function setPaymentProvider(provider: IPaymentProvider | null): void {
  activeProviderInstance = provider;
}
