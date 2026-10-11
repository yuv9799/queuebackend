import * as Department from '../../models/Department.js';
import * as Area from '../../models/Area.js';
import * as Doctor from '../../models/Doctor.js';
import { normalizeIndianPhone } from '../sms/index.js';
import { createQueueToken } from '../tokens/create.js';

export function validatePatientName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name)) {
    return null;
  }
  return name;
}

export function prepareBooking({
  departmentId,
  areaId,
  doctorId,
  patientName,
  phone,
  whatsappOptIn = false,
}) {
  const department = Department.findById(departmentId);
  const area = Area.findById(areaId);
  const normalizedName = validatePatientName(patientName);
  const normalizedPhone = normalizeIndianPhone(phone);
  if (!department || !department.enabled) throw new Error('That department is no longer available.');
  if (!area || !area.enabled || Number(area.department_id) !== Number(departmentId)) {
    throw new Error('That service area is no longer available. Please choose an area again.');
  }
  if (!normalizedName) throw new Error('Please enter a valid name (2–80 characters).');
  if (!normalizedPhone) throw new Error('Please enter a valid Indian mobile number.');

  let doctor = null;
  if (doctorId) {
    doctor = Doctor.findById(doctorId);
    if (!doctor || !doctor.active || Number(doctor.department_id) !== Number(departmentId)
      || !['available', 'busy', 'in_consultation'].includes(doctor.status)) {
      throw new Error('That doctor is no longer available. Please choose another option.');
    }
  }
  return {
    department,
    area,
    doctor,
    patientName: normalizedName,
    phone: normalizedPhone,
    whatsappOptIn: whatsappOptIn === true,
  };
}

export async function createAssistantToken({ app, booking }) {
  const validated = prepareBooking({
    departmentId: booking.department?.id || booking.departmentId,
    areaId: booking.area?.id || booking.areaId,
    doctorId: booking.doctor?.id || booking.doctorId,
    patientName: booking.patientName,
    phone: booking.phone,
    whatsappOptIn: booking.whatsappOptIn,
  });
  const result = await createQueueToken({
    app,
    source: 'ai_assistant',
    actor: null,
    body: {
      departmentId: validated.department.id,
      areaId: validated.area.id,
      doctorId: validated.doctor?.id || null,
      patientName: validated.patientName,
      phone: validated.phone,
      whatsappOptIn: validated.whatsappOptIn,
    },
  });
  const { token } = result;
  return {
    result: {
      id: token.id,
      number: token.token_number,
      tokenCode: token.token_code,
      status: token.status,
      department: token.department_name,
      area: token.area_name,
      floor: token.area_floor,
      counter: token.counter_name,
      doctor: token.doctor_name,
      position: result.position,
      peopleAhead: result.peopleAhead,
      estimatedWaitMinutes: result.estimatedWaitMinutes,
      estimatedServiceTime: result.estimatedServiceTime,
    },
    smsNotification: result.smsNotification,
    whatsappNotification: result.whatsappNotification,
  };
}
