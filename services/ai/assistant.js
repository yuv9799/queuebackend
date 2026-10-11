import { classifyIntent, isEmergencyMessage, isMedicalAdviceRequest } from './intent.js';
import { matchDepartments, rankDepartments } from './departmentMatcher.js';
import { emergencyResponse } from './emergency.js';
import {
  findActiveTokenByPhone,
  getAreas,
  getDepartments,
  getDoctors,
  getLiveQueue,
  getRecommendedDoctor,
  getTokenByNumber,
  getTokenStatus,
} from './tools.js';
import { createAssistantToken, prepareBooking, validatePatientName } from './booking.js';
import { normalizeIndianPhone } from '../sms/index.js';

export function createAssistantState(tokenId = null) {
  return {
    intent: null,
    step: 'intent',
    departmentId: null,
    departmentName: null,
    areaId: null,
    areaName: null,
    doctorId: null,
    doctorName: null,
    estimatedWaitMinutes: null,
    doctorChoiceMade: false,
    patientName: null,
    phone: null,
    allowDuplicate: false,
    duplicateTokenId: null,
    tokenId: tokenId ? Number(tokenId) : null,
    whatsappOptIn: false,
    emergencyDetected: false,
    processing: false,
    confidence: null,
    intentReason: null,
  };
}

function publicState(state) {
  const phoneDigits = state.phone ? String(state.phone).replace(/\D/g, '') : '';
  return {
    intent: state.intent,
    step: state.step,
    departmentId: state.departmentId,
    departmentName: state.departmentName,
    areaId: state.areaId,
    areaName: state.areaName,
    doctorId: state.doctorId,
    doctorName: state.doctorName,
    patientName: state.patientName,
    phoneMasked: phoneDigits ? `+91 ******${phoneDigits.slice(-4)}` : null,
    tokenId: state.tokenId,
    emergencyDetected: state.emergencyDetected,
  };
}

function response(state, message, actions = [], extra = {}) {
  return {
    message,
    intent: state.intent || 'UNKNOWN',
    confidence: state.confidence,
    reason: state.intentReason,
    state: publicState(state),
    actions,
    ...extra,
  };
}

function button(type, label, data = {}) {
  return { type, label, data };
}

function resetBooking(state) {
  const tokenId = state.tokenId;
  Object.assign(state, createAssistantState(tokenId));
}

function liveDepartment(id) {
  return getDepartments().find((department) => Number(department.id) === Number(id)) || null;
}

function liveArea(id, departmentId) {
  return getAreas(departmentId).find((area) => Number(area.id) === Number(id)) || null;
}

function liveDoctor(id, departmentId) {
  return getDoctors(departmentId).find((doctor) => Number(doctor.id) === Number(id)) || null;
}

function collectBookingChoices(state) {
  const areas = getAreas(state.departmentId);
  const doctors = getDoctors(state.departmentId);
  const actions = [];
  if (!state.areaId && areas.length > 1) {
    actions.push(...areas.map((area) => button('SELECT_AREA', `${area.name}${area.floor ? ` · ${area.floor}` : ''}`, {
      areaId: area.id,
    })));
  } else if (!state.areaId && areas.length === 1) {
    state.areaId = areas[0].id;
    state.areaName = areas[0].name;
  }
  if (!state.doctorChoiceMade) {
    actions.push(button('SELECT_BEST', 'Let KIMS assign the best available doctor'));
    actions.push(...doctors.slice(0, 6).map((doctor) => {
      const availability = {
        available: 'Available',
        busy: 'Busy',
        in_consultation: 'In consultation',
      }[doctor.status] || 'Availability updates live';
      const wait = Number.isFinite(doctor.estimatedQueueMinutes)
        ? ` · ~${doctor.estimatedQueueMinutes} min queue`
        : '';
      return button('SELECT_DOCTOR', `${doctor.name} · ${availability}${wait}`, { doctorId: doctor.id });
    }));
  }

  if (!areas.length) {
    state.step = 'unavailable';
    return {
      message: `I couldn't find an active service area for ${state.departmentName}. Please use the Token Kiosk or ask hospital staff for help.`,
      actions: [button('OPEN_KIOSK', 'Open Token Kiosk')],
    };
  }
  if (!state.areaId || !state.doctorChoiceMade) {
    state.step = !state.areaId ? 'area_and_doctor_selection' : 'doctor_selection';
    const intro = state.doctorChoiceMade
      ? `Please choose a service area for ${state.departmentName}.`
      : `I can help with ${state.departmentName}. Choose a service area if there is more than one, then choose a doctor or let KIMS assign one.`;
    return { message: intro, actions };
  }

  state.step = 'patient_name';
  return { message: 'What name should I use for the token?', actions: [] };
}

function beginBooking(state, query) {
  resetBooking(state);
  const classification = classifyIntent(query);
  state.confidence = classification.intent === 'UNKNOWN' ? 0.75 : classification.confidence;
  state.intentReason = classification.intent === 'UNKNOWN'
    ? 'Request matched against active hospital department data'
    : classification.reason;
  const requestedDoctors = findRequestedDoctor(query);
  if (requestedDoctors.length === 1) {
    state.intent = 'TOKEN_BOOKING';
    state.emergencyDetected = false;
    state.departmentId = requestedDoctors[0].department.id;
    state.departmentName = requestedDoctors[0].department.name;
    state.doctorId = requestedDoctors[0].doctor.id;
    state.doctorName = requestedDoctors[0].doctor.name;
    state.estimatedWaitMinutes = requestedDoctors[0].doctor.estimatedQueueMinutes ?? null;
    state.doctorChoiceMade = true;
    const choices = collectBookingChoices(state);
    return response(state, choices.message, choices.actions);
  }
  if (requestedDoctors.length > 1) {
    const uniqueDepartments = [...new Map(requestedDoctors.map(({ department }) => (
      [department.id, department]
    ))).values()];
    state.step = 'department_selection';
    return response(state, 'I found that doctor name in more than one department. Which department did you mean?', uniqueDepartments.map((department) => (
      button('SELECT_DEPARTMENT', `${department.name} (${department.code})`, { departmentId: department.id })
    )));
  }

  const ranked = rankDepartments(query, getDepartments());
  const matches = ranked.map((entry) => entry.department);
  state.intent = 'TOKEN_BOOKING';
  state.emergencyDetected = false;
  if (matches.length === 0) {
    state.step = 'department';
    return response(
      state,
      'I couldn’t match that request to an active department. You can browse the current departments or tell me the specialty you need.',
      [button('OPEN_DEPARTMENTS', 'View Departments')]
    );
  }

  if (ranked[1] && ranked[0].score === ranked[1].score) {
    state.step = 'department_selection';
    return response(state, 'Which department would you like to visit?', ranked.slice(0, 5).map(({ department }) => (
      button('SELECT_DEPARTMENT', `${department.name} (${department.code})`, { departmentId: department.id })
    )));
  }
  const top = matches[0];
  state.departmentId = top.id;
  state.departmentName = top.name;
  const choices = collectBookingChoices(state);
  return response(state, choices.message, choices.actions);
}

function normalizeMatch(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function findRequestedDoctor(description) {
  const query = normalizeMatch(description);
  if (!query) return [];
  return getDepartments().flatMap((department) => getDoctors(department.id)
    .filter((doctor) => query.includes(normalizeMatch(doctor.name)))
    .map((doctor) => ({ department, doctor })));
}

function doctorView(state) {
  const recommended = getRecommendedDoctor(state.departmentId);
  if (recommended) {
    state.doctorId = recommended.id;
    state.doctorName = recommended.name;
    state.estimatedWaitMinutes = recommended.estimatedQueueMinutes ?? null;
  } else {
    state.doctorId = null;
    state.doctorName = 'Best available doctor';
    state.estimatedWaitMinutes = null;
  }
  state.doctorChoiceMade = true;
}

function beginConfirmation(state) {
  try {
    const booking = prepareBooking(state);
    const duplicate = findActiveTokenByPhone(booking.phone);
    if (duplicate && !state.allowDuplicate) {
      state.step = 'duplicate';
      state.duplicateTokenId = duplicate.token.id;
      return response(
        state,
        `There is already an active token for this mobile number: ${duplicate.token.token_code} (${duplicate.token.status}). You can track it instead, or explicitly continue to request another token.`,
        [
          button('TRACK_EXISTING', 'Track existing token', { tokenId: duplicate.token.id }),
          button('CONTINUE_DUPLICATE', 'Continue anyway'),
          button('CANCEL_BOOKING', 'Cancel'),
        ],
        { token: duplicate },
      );
    }
    state.step = 'confirmation';
    state.phone = booking.phone;
    state.patientName = booking.patientName;
    state.departmentName = booking.department.name;
    state.areaName = booking.area.name;
    state.doctorName = booking.doctor?.name || state.doctorName || 'Best available doctor';
    return response(
      state,
      'Please review the details. I will only request a token after you confirm. WhatsApp is optional; choose the WhatsApp action only if you agree to receive this token notification at the number shown.',
      confirmationActions(state),
      {
        confirmation: {
          department: state.departmentName,
          area: state.areaName,
          doctor: state.doctorName,
          patientName: state.patientName,
          phoneMasked: publicState(state).phoneMasked,
          estimatedWaitMinutes: state.estimatedWaitMinutes,
        },
      },
    );
  } catch (error) {
    state.step = 'phone';
    return response(
      state,
      error.message || 'I couldn’t validate those details. Please check them and try again.',
      [],
    );
  }
}

function confirmationActions(state) {
  return [
    button(
      'SET_WHATSAPP_OPT_IN',
      state.whatsappOptIn ? 'Turn off WhatsApp notification' : 'Also notify me on WhatsApp',
      { enabled: !state.whatsappOptIn },
    ),
    button('CONFIRM_BOOKING', 'Confirm & Generate Token'),
    button('EDIT_DETAILS', 'Edit details'),
    button('CANCEL_BOOKING', 'Cancel'),
  ];
}

function tokenReply(state, details, prefix = 'Here is the latest status for your token.') {
  if (!details) {
    state.step = 'tracking_number';
    return response(state, 'I couldn’t find that token. Please enter the token number shown on your receipt, or open My Token.', [
      button('OPEN_STATUS', 'Open My Token'),
    ]);
  }
  state.tokenId = details.token.id;
  state.step = 'tracking';
  const t = details.token;
  const positionText = details.position == null
    ? `Current status: ${t.status}.`
    : `You are #${details.position} in the queue, with ${details.peopleAhead ?? Math.max(0, details.position - 1)} people ahead.`;
  const waitText = details.estimatedWaitMinutes == null
    ? ''
    : ` Estimated wait: about ${details.estimatedWaitMinutes} minutes.`;
  return response(
    state,
    `${prefix} Token ${t.token_code}. ${positionText}${waitText}${t.doctor_name ? ` Doctor: ${t.doctor_name}.` : ''}`,
    [
      button('REFRESH_TOKEN', 'Refresh status', { tokenId: t.id }),
      button('OPEN_LIVE', 'Open Live Board'),
      button('OPEN_STATUS', 'Open My Token', { tokenId: t.id }),
    ],
    { token: details },
  );
}

function routeIntent(state, message, contextTokenId) {
  const classified = classifyIntent(message);
  state.intent = classified.intent;
  state.confidence = classified.confidence;
  state.intentReason = classified.reason;
  if (classified.intent === 'TOKEN_BOOKING') return beginBooking(state, message);
  if (classified.intent === 'DOCTOR_SEARCH') {
    const departments = matchDepartments(message, getDepartments());
    if (departments.length) {
      const department = departments[0];
      const doctors = getDoctors(department.id);
      return response(state, doctors.length
        ? `Doctors currently listed for ${department.name}: ${doctors.map((doctor) => doctor.name).join(', ')}. Their availability can change; choose one during token booking or let KIMS assign a doctor.`
        : `I couldn’t find an active doctor listing for ${department.name}. You can still ask the Token Kiosk or hospital staff to help.`, [
        button('BOOK_TOKEN', `Book ${department.name}`),
      ]);
    }
    return response(state, 'Which department or specialty are you looking for?', [button('OPEN_DEPARTMENTS', 'View Departments')]);
  }
  if (classified.intent === 'DEPARTMENT_SEARCH') {
    const departments = getDepartments();
    return response(state, departments.length
      ? `These are the active departments: ${departments.map((department) => department.name).join(', ')}.`
      : 'There are no active departments available right now.', [
      button('OPEN_DEPARTMENTS', 'View Departments'),
      button('BOOK_TOKEN', 'Book a Token'),
    ]);
  }
  if (classified.intent === 'TOKEN_TRACKING') {
    const id = contextTokenId || state.tokenId;
    if (id) return tokenReply(state, getTokenStatus(id), 'I checked your saved token.');
    const number = message.match(/\b([A-Z]{1,8}-?0*\d+|0*\d{1,8})\b/i)?.[1];
    if (number) return tokenReply(state, getTokenByNumber(number));
    state.step = 'tracking_number';
    return response(state, 'I can check a token saved on this device, or you can enter the token number shown on your receipt.', [
      button('OPEN_STATUS', 'Open My Token'),
    ]);
  }
  if (classified.intent === 'QUEUE_INFORMATION') {
    const queues = getLiveQueue();
    if (!queues.length) return response(state, 'There are no active queue entries on the Live Board right now.', [
      button('OPEN_LIVE', 'Open Live Board'),
    ]);
    return response(state, `The Live Board currently shows ${queues.reduce((sum, queue) => sum + queue.waitingCount, 0)} people waiting across ${queues.length} service areas. Queue times change as tokens are served.`, [
      button('OPEN_LIVE', 'Open Live Board'),
    ]);
  }
  if (classified.intent === 'WEBSITE_HELP') {
    return response(state, 'KIMS Queue can help you get a token, track an existing token, browse departments, and view the live queue. Tell me what you would like to do.', [
      button('BOOK_TOKEN', 'Book a Token'),
      button('TRACK_TOKEN', 'Track My Token'),
      button('OPEN_DEPARTMENTS', 'View Departments'),
      button('OPEN_EMERGENCY', 'Emergency Help'),
    ]);
  }
  if (classified.intent === 'GENERAL_INFORMATION') {
    return response(state, 'I can’t diagnose symptoms or recommend medicines. I can help you find a KIMS department or route you to Emergency Help if this may be urgent.', [
      button('OPEN_DEPARTMENTS', 'Find a Department'),
      button('OPEN_EMERGENCY', 'Emergency Help'),
    ]);
  }
  if (classified.intent === 'UNKNOWN' && matchDepartments(message, getDepartments()).length) {
    return beginBooking(state, message);
  }
  return response(state, 'I can help you book or track a token, find a department or doctor, or open Emergency Help. What would you like to do?', [
    button('BOOK_TOKEN', 'Book a Token'),
    button('TRACK_TOKEN', 'Track My Token'),
    button('OPEN_DEPARTMENTS', 'Departments'),
    button('OPEN_EMERGENCY', 'Emergency Help'),
  ]);
}

function handleAction(state, action, app, contextTokenId) {
  const data = action?.data || {};
  switch (action?.type) {
    case 'CANCEL_BOOKING':
      resetBooking(state);
      return response(state, 'Okay, I’ve cancelled this assistant booking flow. Your existing tokens are unchanged.', [
        button('BOOK_TOKEN', 'Book a Token'),
      ]);
    case 'SELECT_DEPARTMENT': {
      const department = liveDepartment(data.departmentId);
      if (!department) return response(state, 'That department is no longer available. Please choose from the current list.', [
        button('OPEN_DEPARTMENTS', 'View Departments'),
      ]);
      resetBooking(state);
      state.intent = 'TOKEN_BOOKING';
      state.departmentId = department.id;
      state.departmentName = department.name;
      const choices = collectBookingChoices(state);
      return response(state, choices.message, choices.actions);
    }
    case 'SELECT_AREA': {
      const area = liveArea(data.areaId, state.departmentId);
      if (!area) return response(state, 'That service area is no longer available. Please choose again.', collectBookingChoices(state).actions);
      state.areaId = area.id;
      state.areaName = area.name;
      const choices = collectBookingChoices(state);
      return response(state, choices.message, choices.actions);
    }
    case 'SELECT_DOCTOR': {
      const doctor = liveDoctor(data.doctorId, state.departmentId);
      if (!doctor) return response(state, 'That doctor is no longer available. Choose another doctor or let KIMS assign one.', collectBookingChoices(state).actions);
      state.doctorId = doctor.id;
      state.doctorName = doctor.name;
      state.estimatedWaitMinutes = doctor.estimatedQueueMinutes ?? null;
      state.doctorChoiceMade = true;
      const choices = collectBookingChoices(state);
      return response(state, choices.message, choices.actions);
    }
    case 'SELECT_BEST': {
      doctorView(state);
      const choices = collectBookingChoices(state);
      return response(state, choices.message, choices.actions);
    }
    case 'CONTINUE_DUPLICATE':
      if (state.step !== 'duplicate') return response(state, 'Please start a token request before continuing.');
      state.allowDuplicate = true;
      return beginConfirmation(state);
    case 'TRACK_EXISTING':
      return tokenReply(state, getTokenStatus(data.tokenId || state.duplicateTokenId), 'You already have an active token.');
    case 'EDIT_DETAILS':
      state.patientName = null;
      state.phone = null;
      state.whatsappOptIn = false;
      state.allowDuplicate = false;
      state.duplicateTokenId = null;
      state.step = 'patient_name';
      return response(state, 'Please enter the patient name again. The existing department and doctor selection are kept.');
    case 'CONFIRM_BOOKING':
      return confirmBooking(state, app);
    case 'SET_WHATSAPP_OPT_IN':
      if (state.step !== 'confirmation') {
        return response(state, 'WhatsApp consent can only be changed while reviewing a token request.');
      }
      state.whatsappOptIn = data.enabled === true;
      return response(
        state,
        state.whatsappOptIn
          ? 'WhatsApp token notification is enabled for this token request. Confirm below to continue.'
          : 'WhatsApp token notification is off for this token request. Confirm below to continue.',
        confirmationActions(state),
        {
          confirmation: {
            department: state.departmentName,
            area: state.areaName,
            doctor: state.doctorName,
            patientName: state.patientName,
            phoneMasked: publicState(state).phoneMasked,
            estimatedWaitMinutes: state.estimatedWaitMinutes,
          },
        },
      );
    case 'REFRESH_TOKEN':
      return tokenReply(
        state,
        getTokenStatus(contextTokenId || data.tokenId || state.tokenId),
        'I refreshed your token status.',
      );
    case 'OPEN_STATUS':
    case 'OPEN_LIVE':
    case 'OPEN_DEPARTMENTS':
    case 'OPEN_KIOSK':
    case 'OPEN_EMERGENCY':
    case 'CALL_EMERGENCY':
    case 'BOOK_TOKEN':
    case 'TRACK_TOKEN':
      return response(state, 'I can help with that. Use the action button to open the relevant KIMS Queue page.', [action]);
    default:
      return response(state, 'That action is not available. Please choose one of the options shown.');
  }
}

async function confirmBooking(state, app) {
  if (state.step !== 'confirmation') {
    if (state.tokenId) return response(state, 'A token has already been generated for this booking.', [], {
      token: getTokenStatus(state.tokenId),
    });
    return response(state, 'Please review the booking details before confirming.');
  }
  if (state.processing) return response(state, 'Your token request is already being processed. Please wait.');
  state.processing = true;
  try {
    const booking = prepareBooking(state);
    const active = findActiveTokenByPhone(booking.phone);
    if (active && !state.allowDuplicate && active.token.id !== state.duplicateTokenId) {
      state.step = 'duplicate';
      state.duplicateTokenId = active.token.id;
      return response(
        state,
        `There is already an active token for this mobile number: ${active.token.token_code} (${active.token.status}). Track it instead, or explicitly continue to request another token.`,
        [
          button('TRACK_EXISTING', 'Track existing token', { tokenId: active.token.id }),
          button('CONTINUE_DUPLICATE', 'Continue anyway'),
          button('CANCEL_BOOKING', 'Cancel'),
        ],
        { token: active },
      );
    }
    if (state.duplicateTokenId && !state.allowDuplicate) {
      return response(state, 'An active token already exists for this mobile number. Track it instead, or choose Continue anyway first.', [
        button('TRACK_EXISTING', 'Track existing token', { tokenId: state.duplicateTokenId }),
        button('CONTINUE_DUPLICATE', 'Continue anyway'),
      ]);
    }
    const created = await createAssistantToken({ app, booking });
    state.tokenId = created.result.id;
    state.step = 'completed';
    const smsAccepted = created.smsNotification?.accepted === true;
    const message = [
      `Your token ${created.result.tokenCode} has been generated successfully.`,
      ...(smsAccepted ? ['Token details were accepted for SMS delivery.'] : []),
      ...(created.whatsappNotification?.accepted
        ? ['WhatsApp token details were accepted for delivery.']
        : []),
      ...(!smsAccepted && !created.whatsappNotification?.accepted
        ? ['You can still track your token here.']
        : []),
    ].join(' ');
    return response(state, message, [
      button('OPEN_STATUS', 'Track My Token', { tokenId: created.result.id }),
      button('OPEN_LIVE', 'Open Live Board'),
    ], {
      token: created.result,
      smsNotification: created.smsNotification,
      whatsappNotification: created.whatsappNotification,
    });
  } catch (error) {
    console.error('AI token creation failed:', error?.name || 'Error');
    state.step = 'confirmation';
    const active = findActiveTokenByPhone(state.phone);
    if (active && active.token.id !== state.duplicateTokenId) {
      return tokenReply(state, active, 'Your token was created. I could not complete the confirmation response, so here are the verified token details.');
    }
    return response(state, 'I couldn’t verify the token result. Please check My Token or ask hospital staff before trying again.', [
      button('OPEN_STATUS', 'Check My Token', { tokenId: state.tokenId }),
      button('OPEN_KIOSK', 'Open Token Kiosk'),
    ]);
  } finally {
    state.processing = false;
  }
}

export async function handleAssistantRequest({ app, state, message = '', action = null, contextTokenId = null }) {
  const text = String(message || '').trim();
  if (text && isEmergencyMessage(text)) {
    resetBooking(state);
    state.intent = 'EMERGENCY';
    state.emergencyDetected = true;
    state.confidence = 0.99;
    state.intentReason = 'Possible emergency language detected';
    const emergency = emergencyResponse();
    return response(state, emergency.message, emergency.actions);
  }

  if (action) return handleAction(state, action, app, contextTokenId);
  if (!text) return response(state, 'Please type a message or choose one of the quick actions.');

  const classified = classifyIntent(text);
  if (classified.intent === 'CANCEL_TOKEN') {
    resetBooking(state);
    return response(state, 'Okay, I’ve cancelled this assistant booking flow. No token was generated.', [
      button('BOOK_TOKEN', 'Book a Token'),
    ]);
  }
  if (isMedicalAdviceRequest(text)) {
    state.intent = 'GENERAL_INFORMATION';
    state.confidence = classified.confidence;
    state.intentReason = classified.reason;
    return response(state, 'I can’t diagnose symptoms or recommend medicines. I can help you find a hospital department. If you think this may be urgent, open Emergency Help now.', [
      button('OPEN_DEPARTMENTS', 'Find a Department'),
      button('OPEN_EMERGENCY', 'Emergency Help'),
    ]);
  }

  if (state.step === 'patient_name') {
    const nameText = text.replace(/^(my name is|name is|patient name is|मेरा नाम)\s*/i, '');
    const name = validatePatientName(nameText);
    if (!name) return response(state, 'Please enter a name using 2–80 letters. I don’t need any medical details.');
    state.patientName = name;
    state.step = 'phone';
    return response(state, 'What is your Indian mobile number? It will be used only for this token and its notification.');
  }
  if (state.step === 'phone') {
    const phoneInput = text.match(/(?:\+?91[\s().-]*)?0?[6-9](?:[\s().-]*\d){9}/)?.[0] || text;
    const phone = normalizeIndianPhone(phoneInput);
    if (!phone) return response(state, 'That doesn’t look like a valid Indian mobile number. Please enter a 10-digit number, or include +91.');
    state.phone = phone;
    return beginConfirmation(state);
  }
  if (state.step === 'tracking_number') {
    const details = getTokenByNumber(text);
    return tokenReply(state, details);
  }
  if (state.step === 'department_selection') {
    const matches = matchDepartments(text, getDepartments());
    if (!matches.length) return response(state, 'Please select one of the active department options shown above.');
    state.departmentId = matches[0].id;
    state.departmentName = matches[0].name;
    const choices = collectBookingChoices(state);
    return response(state, choices.message, choices.actions);
  }
  if (['area_and_doctor_selection', 'doctor_selection'].includes(state.step)) {
    if (classified.intent === 'TOKEN_BOOKING') return beginBooking(state, text);
    return response(state, 'Please choose a service area and a doctor option above, or cancel to start over.', []);
  }
  if (state.step === 'confirmation') {
    if (/^(yes|confirm|generate|हाँ|पुष्टि)$/i.test(text)) {
      return confirmBooking(state, app);
    }
    return response(state, 'Your token has not been generated yet. Please use Confirm & Generate Token to proceed.', [
      button('CONFIRM_BOOKING', 'Confirm & Generate Token'),
      button('EDIT_DETAILS', 'Edit details'),
      button('CANCEL_BOOKING', 'Cancel'),
    ]);
  }
  if (state.step === 'duplicate') {
    return response(state, 'Please choose whether to track the existing token or explicitly continue with another token.', [
      button('TRACK_EXISTING', 'Track existing token', { tokenId: state.duplicateTokenId }),
      button('CONTINUE_DUPLICATE', 'Continue anyway'),
      button('CANCEL_BOOKING', 'Cancel'),
    ]);
  }
  if (state.step === 'completed' && classified.intent === 'TOKEN_BOOKING') {
    resetBooking(state);
    return beginBooking(state, text);
  }
  return routeIntent(state, text, contextTokenId || state.tokenId);
}
