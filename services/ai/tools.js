import * as Department from '../../models/Department.js';
import * as Area from '../../models/Area.js';
import * as Doctor from '../../models/Doctor.js';
import * as Token from '../../models/Token.js';
import * as Queue from '../../models/Queue.js';
import { normalizeIndianPhone } from '../sms/index.js';

export function getDepartments() {
  return Department.list().filter((department) => department.enabled);
}

export function getAreas(departmentId) {
  return Area.list({ departmentId }).filter((area) => area.enabled);
}

export function getDoctors(departmentId) {
  return Doctor.list({ departmentId, active: true })
    .filter((doctor) => ['available', 'busy', 'in_consultation'].includes(doctor.status))
    .map(({ currentToken, nextPatients, ...doctor }) => doctor);
}

export function getRecommendedDoctor(departmentId, preferredDoctorId = null) {
  const doctor = Queue.findBestDoctorForDepartment(departmentId, { preferredDoctorId });
  if (!doctor || !doctor.active || !['available', 'busy', 'in_consultation'].includes(doctor.status)) {
    return null;
  }
  return doctor;
}

export function getTokenStatus(tokenId) {
  const token = Token.findById(tokenId);
  if (!token) return null;
  const estimates = Queue.calculateEstimates(token);
  return {
    token: {
      id: token.id,
      token_code: token.token_code,
      token_number: token.token_number,
      status: token.status,
      department_name: token.department_name,
      area_name: token.area_name,
      area_floor: token.area_floor,
      counter_name: token.counter_name,
      doctor_name: token.doctor_name,
    },
    ...estimates,
  };
}

export function getTokenByNumber(value) {
  const text = String(value || '').trim();
  const prefixed = text.match(/^([A-Z]{1,8})-0*(\d+)$/i);
  if (prefixed) {
    const token = Token.findByCode(prefixed[1], Number(prefixed[2]));
    if (!token) return null;
    return {
      token: {
        id: token.id,
        token_code: token.token_code,
        token_number: token.token_number,
        status: token.status,
        department_name: token.department_name,
        area_name: token.area_name,
        doctor_name: token.doctor_name,
      },
      ...Queue.calculateEstimates(token),
    };
  }
  const match = text.match(/^0*(\d+)$/);
  if (!match) return null;
  const token = Token.findByNumber(Number(match[1]));
  if (!token) return null;
  const estimates = Queue.calculateEstimates(token);
  return {
    token: {
      id: token.id,
      token_code: token.token_code,
      token_number: token.token_number,
      status: token.status,
      department_name: token.department_name,
      area_name: token.area_name,
      doctor_name: token.doctor_name,
    },
    ...estimates,
  };
}

export function findActiveTokenByPhone(phone) {
  const normalized = normalizeIndianPhone(phone);
  if (!normalized) return null;
  const token = Token.findActiveByPhone(normalized);
  if (!token) return null;
  const estimates = Queue.calculateEstimates(token);
  return {
    token: {
      id: token.id,
      token_code: token.token_code,
      token_number: token.token_number,
      status: token.status,
      department_name: token.department_name,
      doctor_name: token.doctor_name,
    },
    ...estimates,
  };
}

export function getLiveQueue(departmentId = null) {
  return Token.live().filter((section) => (
    !departmentId || Number(section.area?.department_id) === Number(departmentId)
  )).map((section) => ({
    area: section.area,
    servingCount: section.serving.length,
    waitingCount: section.queue.length + section.held.length,
    nowServing: section.serving.map((token) => ({
      token_code: token.token_code,
      status: token.status,
      doctor_name: token.doctor_name,
    })),
  }));
}
