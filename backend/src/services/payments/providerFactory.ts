import { IPaymentProvider } from './types.js';
import { MockSandboxPayoutProvider } from './mockSandboxProvider.js';
import { RazorpayXPayoutProvider } from './razorpayXProvider.js';

let activeProviderInstance: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (activeProviderInstance) {
    return activeProviderInstance;
  }

  const configured = (process.env.PAYMENTS_PROVIDER || 'sandbox').toLowerCase().trim();

  switch (configured) {
    case 'razorpayx':
    case 'razorpay':
      activeProviderInstance = new RazorpayXPayoutProvider();
      break;

    case 'sandbox':
    case 'mock':
    case 'test':
    default:
      activeProviderInstance = new MockSandboxPayoutProvider();
      break;
  }

  return activeProviderInstance;
}

// Allows test suite to inject or reset provider
export function setPaymentProvider(provider: IPaymentProvider | null): void {
  activeProviderInstance = provider;
}
