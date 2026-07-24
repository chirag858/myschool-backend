import { ApiError } from '../../lib/api-error';
import { SchoolModel } from '../school/school.model';
import { PlatformConfigModel } from './platform.model';

interface ModuleCatalogEntry {
  key: string;
  name: string;
  description: string;
  icon: string;
  locked: boolean;
}

const MODULE_CATALOG: readonly ModuleCatalogEntry[] = [
  { key: 'student_mgmt', name: 'Student Management', description: 'Admissions, profiles, promotions.', icon: 'graduationCap', locked: true },
  { key: 'fee_mgmt', name: 'Fee Management', description: 'Fee structure + collection + ledger.', icon: 'wallet', locked: true },
  { key: 'attendance', name: 'Attendance', description: 'Daily student + staff attendance.', icon: 'clipboardCheck', locked: true },
  { key: 'examinations', name: 'Examinations', description: 'Exam scheduling, marks, report cards.', icon: 'clipboardList', locked: false },
  { key: 'timetable', name: 'Timetable', description: 'Weekly schedule + conflict detection.', icon: 'calendar', locked: false },
  { key: 'transport', name: 'Transport', description: 'Vehicles, routes, GPS tracking.', icon: 'bus', locked: false },
  { key: 'hostel', name: 'Hostel', description: 'Hostel rooms, allocations, visitors.', icon: 'hostel', locked: false },
  { key: 'library', name: 'Library', description: 'Books, issues, fines.', icon: 'library', locked: false },
  { key: 'inventory', name: 'Inventory', description: 'Items, purchases, stock issues.', icon: 'package', locked: false },
  { key: 'payroll', name: 'Payroll', description: 'Staff salary disbursement.', icon: 'creditCard', locked: false },
  { key: 'communication', name: 'Communication', description: 'SMS, WhatsApp, circulars, messaging.', icon: 'mail', locked: false },
  { key: 'gate', name: 'Out Pass / Gate', description: 'Gate movement logs.', icon: 'mapPin', locked: false },
  { key: 'analytics', name: 'Smart Analytics', description: 'Multi-module analytics dashboard.', icon: 'barChart', locked: false },
];

interface AppCatalogEntry {
  key: 'parent_app' | 'teacher_app' | 'student_app' | 'driver_app';
  name: string;
  description: string;
}

const APP_CATALOG: readonly AppCatalogEntry[] = [
  { key: 'parent_app', name: 'Parent App', description: 'Mobile app for parents — receipts, attendance, results.' },
  { key: 'teacher_app', name: 'Teacher App', description: 'Mobile app for teachers — attendance, marks, leave.' },
  { key: 'student_app', name: 'Student App', description: 'Mobile app for students — timetable, homework, exams.' },
  { key: 'driver_app', name: 'Driver App', description: 'Mobile app for drivers — route, attendance, GPS.' },
];

async function getConfig() {
  const doc = await PlatformConfigModel.findOneAndUpdate(
    {},
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc as { moduleOverrides: Record<string, boolean>; appOverrides: Record<string, boolean> };
}

export const platformService = {
  async getModulesOverview() {
    const [config, schools] = await Promise.all([
      getConfig(),
      SchoolModel.find({}).select('moduleFlags').lean(),
    ]);

    // moduleFlags is a sparse Record<key, boolean> per school — absent means
    // enabled by default, so count schools where the flag isn't explicitly false.
    const enabledCounts = new Map<string, number>();
    for (const entry of MODULE_CATALOG) {
      const count = schools.filter((s) => {
        const flags = s.moduleFlags as Record<string, unknown> | undefined;
        return flags?.[entry.key] !== false;
      }).length;
      enabledCounts.set(entry.key, count);
    }

    return MODULE_CATALOG.map((entry) => ({
      ...entry,
      enabled: entry.locked ? true : config.moduleOverrides?.[entry.key] !== false,
      enabledInSchools: enabledCounts.get(entry.key) ?? 0,
    }));
  },

  async setModuleEnabled(key: string, enabled: boolean) {
    const entry = MODULE_CATALOG.find((m) => m.key === key);
    if (!entry) throw ApiError.notFound('Unknown module');
    if (entry.locked) throw ApiError.badRequest('Core modules cannot be disabled');
    await PlatformConfigModel.updateOne(
      {},
      { $set: { [`moduleOverrides.${key}`]: enabled } },
      { upsert: true },
    );
    return { key, enabled };
  },

  async getAppsOverview() {
    const config = await getConfig();
    return APP_CATALOG.map((entry) => ({
      ...entry,
      enabled: config.appOverrides?.[entry.key] !== false,
    }));
  },

  async setAppEnabled(key: string, enabled: boolean) {
    const entry = APP_CATALOG.find((a) => a.key === key);
    if (!entry) throw ApiError.notFound('Unknown app');
    await PlatformConfigModel.updateOne(
      {},
      { $set: { [`appOverrides.${key}`]: enabled } },
      { upsert: true },
    );
    return { key, enabled };
  },
};
