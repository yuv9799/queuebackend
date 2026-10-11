const EMERGENCY_PATTERNS = [
  /\b(accident|unconscious|not breathing|can't breathe|cannot breathe|difficulty breathing|severe bleeding|bleeding heavily|chest pain|ambulance|emergency|urgent emergency|major injury|fracture|broken (arm|leg|bone)|broke my (arm|leg))\b/i,
  /(बेहोश|सांस नहीं|साँस नहीं|बहुत खून|दुर्घटना|एक्सीडेंट|सीने में दर्द|एम्बुलेंस|आपातकाल)/u,
];

const ADVICE_PATTERNS = [
  /\b(diagnos(e|is)|what disease|what illness|prescri(be|ption)|which medicine|what medicine|medicine should i|treatment for|what should i take)\b/i,
  /\b(medication|tablet|drug|dosage|dose|can i take|should i take)\b/i,
  /(दवा बताइए|कौन सी दवा|इलाज बताइए|मुझे क्या बीमारी|निदान)/u,
];

export function isEmergencyMessage(message) {
  return EMERGENCY_PATTERNS.some((pattern) => pattern.test(message));
}

export function isMedicalAdviceRequest(message) {
  return ADVICE_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyIntent(message) {
  const text = String(message || '').trim();
  if (isEmergencyMessage(text)) {
    return { intent: 'EMERGENCY', confidence: 0.99, reason: 'Possible emergency language detected' };
  }
  if (/\b(cancel|stop|never mind|nevermind|शुरू नहीं|रद्द)\b/i.test(text)) {
    return { intent: 'CANCEL_TOKEN', confidence: 0.9, reason: 'User asked to cancel the current assistant flow' };
  }
  if (isMedicalAdviceRequest(text)) {
    return { intent: 'GENERAL_INFORMATION', confidence: 0.96, reason: 'Medical advice request routed to a safety response' };
  }
  if (/\b(departments?|specialt(y|ies)|services|clinic list)\b/i.test(text)
    || /(विभाग|डिपार्टमेंट|विशेषज्ञता)/u.test(text)) {
    return { intent: 'DEPARTMENT_SEARCH', confidence: 0.88, reason: 'User asks to browse hospital departments' };
  }
  if (/\b(find|search|list|available)\b.*\b(doctors?|physicians?)\b/i.test(text)
    || /\b(doctors?|physicians?)\b.*\b(available|list|near me)\b/i.test(text)) {
    return { intent: 'DOCTOR_SEARCH', confidence: 0.86, reason: 'User asks to find available doctors' };
  }
  if (/^[A-Z]{1,8}-?0*\d{1,8}$/i.test(text)) {
    return { intent: 'TOKEN_TRACKING', confidence: 0.9, reason: 'User provided a token number' };
  }
  if (/\b(where\b.*\btoken|status|position|track|tracking|wait|turn|my token|token status|token number|refresh)\b/i.test(text)
    || /(मेरा टोकन|टोकन कहाँ|कितनी देर|मेरी बारी)/u.test(text)) {
    return { intent: 'TOKEN_TRACKING', confidence: 0.92, reason: 'User asks about an existing token' };
  }
  if (/\b(queue|live board|how busy|people ahead|how long is the queue)\b/i.test(text)) {
    return { intent: 'QUEUE_INFORMATION', confidence: 0.88, reason: 'User asks about queue information' };
  }
  if (/\b(how (does|do|can)|help|website|use this|how to book)\b/i.test(text)
    || /(कैसे बुक|कैसे इस्तेमाल|मदद चाहिए)/u.test(text)) {
    return { intent: 'WEBSITE_HELP', confidence: 0.84, reason: 'User asks how to use KIMS Queue' };
  }
  if (/\bdr\.?\s+[a-z][\p{L}\p{M}'-]*\b/iu.test(text)
    || /\b(book|booking|doctor|dermatolog(y|ist)|derma|cardiolog(y|ist)|cardio|p(a|e)ediatric(ian|s)?|neurolog(y|ist)|ophthalmolog(y|ist)|gastroenterolog(y|ist)|urolog(y|ist)|pulmonolog(y|ist)|endocrinolog(y|ist)|oncolog(y|ist)|dentist|surgeon|orthop(aedic|edic)|see|consult|appointment|token|fever|skin|itch|acne|rash|pain|specialist|bukhar|khujli|fracture|broken arm|broken leg|bone)\b/i.test(text)
    || /(बुखार|खुजली|त्वचा|डॉक्टर|दिखाना|जांच)/u.test(text)) {
    return { intent: 'TOKEN_BOOKING', confidence: 0.82, reason: 'User likely wants to consult a hospital service' };
  }
  return { intent: 'UNKNOWN', confidence: 0.25, reason: 'No supported patient-facing intent matched' };
}
