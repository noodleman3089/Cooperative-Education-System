/**
 * ระบบจัดการประวัติและการแจ้งเตือน (Notification Store) สำหรับหน้าเว็บ
 * บันทึกลงใน localStorage โดยแยกคีย์ตาม userId และ role เพื่อป้องกันข้อมูลปนกัน
 */

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  type?: 'info' | 'success' | 'warning';
  targetUrl?: string;
  highlightTargetId?: string;
  createdAt: string; // ISO date string
  readAt: string | null; // ISO date string เมื่อกดอ่านแล้ว, null = ยังไม่ได้อ่าน
  isDeleted?: boolean;
}

/** ระบบลบแจ้งเตือนที่เก่ากว่านี้ให้เอง */
export const AUTO_DELETE_DAYS = 30;

const getStorageKey =(userId: number, role: string): string =>
  `coop_notifications_${userId}_${role}`;

/**
 * ดึงรายการแจ้งเตือนทั้งหมดของผู้ใช้ในบทบาทที่กำหนด
 */
export function getStoredNotifications(userId: number, role: string): AppNotification[] {
  if (!userId || !role) return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userId, role));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * บันทึกรายการแจ้งเตือนลง localStorage
 */
export function saveStoredNotifications(
  userId: number,
  role: string,
  notifications: AppNotification[]
): void {
  if (!userId || !role) return;
  try {
    localStorage.setItem(getStorageKey(userId, role), JSON.stringify(notifications));
  } catch (err) {
    console.error('Failed to save notifications to localStorage:', err);
  }
}

/**
 * ซิงค์รายการสดที่ดึงมาจาก API เข้ากับประวัติเดิมใน Store
 * - รายการใหม่จะถูกบันทึกด้วย readAt = null
 * - รายการเดิมที่มีอยู่แล้วจะคงสถานะ readAt และ isDeleted เดิมไว้
 */
export function syncNotifications(
  userId: number,
  role: string,
  liveItems: Array<{
    id: string;
    title: string;
    description: string;
    type?: 'info' | 'success' | 'warning';
    targetUrl?: string;
    highlightTargetId?: string;
  }>
): AppNotification[] {
  if (!userId || !role) return [];
  const existing = getStoredNotifications(userId, role);
  const existingMap = new Map<string, AppNotification>(existing.map((n) => [n.id, n]));

  const now = new Date().toISOString();
  const merged: AppNotification[] = [];

  for (const live of liveItems) {
    const prev = existingMap.get(live.id);
    if (prev) {
      merged.push({
        ...prev,
        title: live.title,
        description: live.description,
        type: live.type || prev.type || 'info',
        targetUrl: live.targetUrl || prev.targetUrl,
        highlightTargetId: live.highlightTargetId || prev.highlightTargetId,
      });
      existingMap.delete(live.id);
    } else {
      merged.push({
        id: live.id,
        title: live.title,
        description: live.description,
        type: live.type || 'info',
        targetUrl: live.targetUrl,
        highlightTargetId: live.highlightTargetId,
        createdAt: now,
        readAt: null,
        isDeleted: false,
      });
    }
  }

  // เก็บรักษารายการประวัติเดิมที่อาจไม่มีใน liveItems แล้ว (เพื่อให้คงดูประวัติย้อนหลังได้)
  for (const prev of existingMap.values()) {
    merged.push(prev);
  }

  // เรียงลำดับจากใหม่สุดไปเก่าสุด
  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  saveStoredNotifications(userId, role, merged);
  // ลบรายการที่เก่ากว่า 30 วันอัตโนมัติทุกครั้งที่ซิงค์ (ไม่มีปุ่มให้กด)
  return deleteOlderThanDays(userId, role, AUTO_DELETE_DAYS);
}

/**
 * ทำเครื่องหมายรายการเดียวว่าอ่านแล้ว
 */
export function markAsRead(
  userId: number,
  role: string,
  notificationId: string
): AppNotification[] {
  const list = getStoredNotifications(userId, role);
  const now = new Date().toISOString();
  const updated = list.map((item) =>
    item.id === notificationId ? { ...item, readAt: item.readAt || now } : item
  );
  saveStoredNotifications(userId, role, updated);
  return updated;
}

/**
 * ทำเครื่องหมายทุกรายการว่าอ่านแล้ว
 */
export function markAllAsRead(userId: number, role: string): AppNotification[] {
  const list = getStoredNotifications(userId, role);
  const now = new Date().toISOString();
  const updated = list.map((item) => ({ ...item, readAt: item.readAt || now }));
  saveStoredNotifications(userId, role, updated);
  return updated;
}

/**
 * ลบรายการแจ้งเตือนรายการเดียว (ทำเครื่องหมาย isDeleted = true)
 */
export function deleteNotification(
  userId: number,
  role: string,
  notificationId: string
): AppNotification[] {
  const list = getStoredNotifications(userId, role);
  const updated = list.map((item) =>
    item.id === notificationId ? { ...item, isDeleted: true } : item
  );
  saveStoredNotifications(userId, role, updated);
  return updated;
}

/**
 * ลบรายการแจ้งเตือนทั้งหมด
 */
export function deleteAllNotifications(userId: number, role: string): AppNotification[] {
  const list = getStoredNotifications(userId, role);
  const updated = list.map((item) => ({ ...item, isDeleted: true }));
  saveStoredNotifications(userId, role, updated);
  return updated;
}

/**
 * ลบรายการที่เก่ากว่าจำนวนวันที่กำหนด (เช่น 30 วัน)
 */
export function deleteOlderThanDays(
  userId: number,
  role: string,
  days: number = 30
): AppNotification[] {
  const list = getStoredNotifications(userId, role);
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  const updated = list.map((item) => {
    const itemTime = new Date(item.createdAt).getTime();
    if (itemTime < threshold) {
      return { ...item, isDeleted: true };
    }
    return item;
  });
  saveStoredNotifications(userId, role, updated);
  return updated;
}

/**
 * นับจำนวนรายการที่ยังไม่ได้อ่านและยังไม่ถูกลบ
 */
export function getUnreadCount(notifications: AppNotification[]): number {
  return notifications.filter((n) => !n.isDeleted && !n.readAt).length;
}

/**
 * กรองเฉพาะรายการที่ยังไม่ถูกลบ
 */
export function getActiveNotifications(notifications: AppNotification[]): AppNotification[] {
  return notifications.filter((n) => !n.isDeleted);
}
