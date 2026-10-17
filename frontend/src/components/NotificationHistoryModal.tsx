import React, { useState, useMemo } from 'react';
import {
  Trash2,
  CheckCheck,
  Calendar,
  Bell,
  FileText,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import { formatThaiDateTime } from '../utils/thaiDate';
import { AUTO_DELETE_DAYS, type AppNotification } from '../utils/notificationStore';

interface NotificationHistoryModalProps {
  open: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onNavigateToTarget: (targetUrl?: string, highlightId?: string) => void;
}

export const NotificationHistoryModal: React.FC<NotificationHistoryModalProps> = ({
  open,
  onClose,
  notifications,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
  onDeleteAll,
  onNavigateToTarget,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read'>('all');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // กรองเฉพาะรายการที่ยังไม่ถูกลบ
  const activeNotifications = useMemo(
    () => notifications.filter((n) => !n.isDeleted),
    [notifications]
  );

  const unreadCount = useMemo(
    () => activeNotifications.filter((n) => !n.readAt).length,
    [activeNotifications]
  );

  const readCount = useMemo(
    () => activeNotifications.filter((n) => !!n.readAt).length,
    [activeNotifications]
  );

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'unread') {
      return activeNotifications.filter((n) => !n.readAt);
    }
    if (activeTab === 'read') {
      return activeNotifications.filter((n) => !!n.readAt);
    }
    return activeNotifications;
  }, [activeNotifications, activeTab]);

  if (!open) return null;

  return (
    <>
      <Modal onClose={onClose} size="lg" title="ประวัติการแจ้งเตือนทั้งหมด">
        <ModalBody className="space-y-4 max-h-[70vh] flex flex-col">
          {/* แถบการกรองและเครื่องมือจัดการ */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
            {/* Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                ทั้งหมด ({activeNotifications.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('unread')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'unread'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                ยังไม่อ่าน ({unreadCount})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('read')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'read'
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                อ่านแล้ว ({readCount})
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors cursor-pointer"
                  title="ทำเครื่องหมายว่าอ่านทั้งหมด"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  อ่านทั้งหมด
                </button>
              )}
              {activeNotifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAll(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                  title="ลบรายการทั้งหมด"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  ลบทั้งหมด
                </button>
              )}
            </div>
          </div>

          {/* รายการแจ้งเตือน */}
          <div className="overflow-y-auto flex-1 divide-y divide-gray-100 dark:divide-gray-800 pr-1">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
                  <Bell className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  {activeTab === 'unread'
                    ? 'ไม่มีการแจ้งเตือนที่ยังไม่ได้อ่าน'
                    : activeTab === 'read'
                    ? 'ไม่มีการแจ้งเตือนที่อ่านแล้ว'
                    : 'ไม่มีประวัติการแจ้งเตือน'}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  เมื่อมีความคืบหน้าของเอกสารหรือคำร้อง ระบบจะบันทึกไว้ที่นี่
                </div>
              </div>
            ) : (
              filteredNotifications.map((item) => {
                const isUnread = !item.readAt;
                return (
                  <div
                    key={item.id}
                    className={`p-3.5 sm:p-4 rounded-xl flex items-start gap-3 transition-colors ${
                      isUnread
                        ? 'bg-blue-50/60 dark:bg-blue-950/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    {/* ไอคอนตามประเภท */}
                    <div
                      className={`p-2 rounded-xl mt-0.5 shrink-0 ${
                        item.type === 'warning'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400'
                          : item.type === 'success'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400'
                      }`}
                    >
                      {item.type === 'warning' ? (
                        <AlertCircle className="w-4 h-4" />
                      ) : item.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>

                    {/* ข้อความและปุ่มคลิกนำทาง */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        onMarkAsRead(item.id);
                        onClose();
                        onNavigateToTarget(item.targetUrl, item.highlightTargetId);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 dark:text-white leading-snug">
                          {item.title}
                        </span>
                        {isUnread && (
                          <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
                        {item.description}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                        <Calendar className="w-3 h-3" />
                        <span>{formatThaiDateTime(item.createdAt)}</span>
                        {item.readAt && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-600 dark:text-emerald-400">อ่านแล้ว</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* ปุ่มลบรายการนี้ */}
                    <button
                      type="button"
                      onClick={() => onDelete(item.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0 cursor-pointer"
                      title="ลบรายการนี้"
                      aria-label="ลบการแจ้งเตือน"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
            ระบบจะลบการแจ้งเตือนให้เองเมื่อผ่านไป {AUTO_DELETE_DAYS} วัน
          </p>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            ปิด
          </Button>
        </ModalFooter>
      </Modal>

      {/* กล่องยืนยันลบทั้งหมด */}
      <ConfirmDialog
        open={confirmDeleteAll}
        title="ยืนยันการลบการแจ้งเตือนทั้งหมด"
        message="ท่านต้องการลบประวัติการแจ้งเตือนทั้งหมดใช่หรือไม่? รายการที่ถูกลบจะไม่สามารถกู้คืนได้"
        confirmLabel="ลบทั้งหมด"
        destructive
        onConfirm={() => {
          onDeleteAll();
          setConfirmDeleteAll(false);
        }}
        onCancel={() => setConfirmDeleteAll(false)}
      />
    </>
  );
};

export default NotificationHistoryModal;
