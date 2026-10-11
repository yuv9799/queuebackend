export function emergencyResponse() {
  return {
    message: '🚨 Emergency assistance may be needed. Please do not wait for a normal queue token. Use KIMS Emergency Help now or call 108.',
    actions: [
      { type: 'OPEN_EMERGENCY', label: '🚨 Emergency Help' },
      { type: 'CALL_EMERGENCY', label: 'Call 108', data: { phone: '108' } },
    ],
  };
}
