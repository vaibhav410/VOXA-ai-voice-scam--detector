/* Versioned sector policies + transparent scam-intent rules (English / Hindi / Hinglish).
   Rules are deliberately simple and auditable; they are decision support, not a verdict. */
window.VOXA_SECTORS = {
  personal: {
    name: 'Personal / Family', version: 'personal-2.0.0', thresholds: { medium: 3, high: 6 },
    boost: { family_emergency: 2, secrecy: 1.5, money_transfer: 1.5 },
    summary: 'requests and pressure tactics associated with financial fraud',
    steps: ['Hang up and call the person back on a number you already know.', 'Ask a question only the real person could answer.', 'Do not send money or share codes while on the call.', 'Tell another family member before acting.']
  },
  finance: {
    name: 'Finance', version: 'finance-2.0.0', thresholds: { medium: 3, high: 5 },
    boost: { otp_pin: 2, credentials_data: 1.5, authority: 1.5 },
    summary: 'patterns often seen in bank-impersonation and OTP/PIN scams',
    steps: ['End the call and contact the bank through the number printed on your card or official app.', 'Never share OTP, PIN or CVV — real staff do not ask for them.', 'Do not install remote-access apps.', 'Review recent transactions and report suspicious activity to your bank.']
  },
  government: {
    name: 'Government / Public Services', version: 'government-2.0.0', thresholds: { medium: 3, high: 5 },
    boost: { legal_threat: 1.5, authority: 1.5, money_transfer: 1.5 },
    summary: 'patterns often seen when callers impersonate officials and invent legal penalties',
    steps: ['Officials do not demand payment over an unsolicited call — hang up.', 'Verify through the department’s official website or helpline.', 'Do not stay on a video call or follow “digital arrest” instructions.', 'Report through your official cybercrime channel.']
  },
  healthcare: {
    name: 'Healthcare', version: 'healthcare-2.0.0', thresholds: { medium: 3, high: 6 },
    boost: { patient_data: 2, family_emergency: 1.5, money_transfer: 1.5 },
    summary: 'patterns often seen in fake clinician calls and emergency-payment requests',
    steps: ['Call the hospital back using its published number.', 'Do not disclose patient or insurance data on an unverified call.', 'Escalate to your compliance or privacy officer.', 'Do not pay emergency fees to a personal account.']
  },
  education: {
    name: 'Education', version: 'education-2.0.0', thresholds: { medium: 3, high: 6 },
    boost: { exam_fee: 2, authority: 1.5, money_transfer: 1.5 },
    summary: 'patterns often seen when callers pose as principals, examiners or scholarship officers',
    steps: ['Verify the caller with the institution’s official office.', 'Pay fees only through the official portal.', 'Do not share exam or personal details by phone.', 'Inform the administration of the attempt.']
  },
  corporate: {
    name: 'Corporate', version: 'corporate-2.0.0', thresholds: { medium: 3, high: 5 },
    boost: { payment_change: 2, credentials_data: 1.5, authority: 1.5, otp_pin: 1.5 },
    summary: 'patterns often seen in CEO, HR and IT-support impersonation',
    steps: ['Confirm the request on a second, known channel.', 'Never share credentials or MFA codes with a caller.', 'Follow the payment-change verification process before any transfer.', 'Report to your security team and keep the call details.']
  }
};

window.VOXA_LIMITS = 'VOXA is decision support, not a verdict. A synthetic voice is not automatically a scam, and a genuine voice can still be used in one. Rule-based intent detection can miss or over-flag; no detector guarantees every deepfake or scam.';

