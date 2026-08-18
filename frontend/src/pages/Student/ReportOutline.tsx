import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import { FileUp, CheckCircle, XCircle, Clock } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage, getErrorName } from '../../utils/errors';

interface Version {
  version_id: number;
  file_path: string;
  submitted_at: string;
  rejection_comment: string | null;
  status: string;
  reviewer_email: string | null;
}

interface OutlineData {
  outline_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  versions: Version[];
}

const ReportOutline: React.FC = () => {
  const auth = useContext(AuthContext);
  const [data, setData] = useState<OutlineData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchOutline = async () => {
      if (!auth?.user) return;
      try {
        setLoading(true);
        setError(null);
        const result = await api.get(`/outlines/student/${auth.user.userId}`, { signal: controller.signal });
        setData(result.data);
      } catch (err) {
        if (getErrorName(err) === 'AbortError') return;
        setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดข้อมูล'));
      } finally {
        setLoading(false);
      }
    };

    fetchOutline();
    return () => controller.abort();
  }, [auth?.user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('ขนาดไฟล์ต้องไม่เกิน 10MB');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append('outline', file);

      await api.post('/outlines', formData);
      
      // Refetch
      const result = await api.get(`/outlines/student/${auth?.user?.userId}`);
      setData(result.data);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์'));
    } finally {
      setUploading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="text-green-500 w-5 h-5" />;
      case 'rejected': return <XCircle className="text-red-500 w-5 h-5" />;
      default: return <Clock className="text-orange-500 w-5 h-5" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'approved': return 'อนุมัติแล้ว';
      case 'rejected': return 'ต้องแก้ไข (ตีกลับ)';
      case 'pending_mentor': return 'รอพี่เลี้ยงตรวจสอบ';
      case 'pending_advisor': return 'รออาจารย์ตรวจสอบ';
      default: return 'รอตรวจสอบ';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">โครงร่างรายงาน (Co-op 11)</h1>
            <p className="text-gray-500 dark:text-gray-400">อัปโหลดและติดตามสถานะการส่งโครงร่างรายงานสหกิจศึกษา</p>
          </div>
          
          <div className="mt-4 md:mt-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              className="hidden"
              accept=".pdf,.doc,.docx"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || data?.status === 'approved'}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all duration-200 shadow-sm
                ${uploading || data?.status === 'approved' 
                  ? 'bg-gray-100 text-gray-600 cursor-not-allowed dark:bg-gray-700 dark:text-gray-400' 
                  : 'bg-brand-blue hover:bg-blue-600 text-white hover:shadow-md hover:shadow-blue-500/20 active:scale-95'}`}
            >
              {uploading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <FileUp className="w-5 h-5" />
              )}
              <span>{uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดโครงร่างใหม่'}</span>
            </button>
          </div>
        </div>

        <AlertBanner variant="error" message={error} className="mb-6" />

        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
          </div>
        ) : !data ? (
          <div className="py-16 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-800/50">
            <FileUp className="w-12 h-12 text-gray-600 dark:text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">ยังไม่มีการส่งโครงร่างรายงาน</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">อัปโหลดไฟล์ PDF หรือ Word เพื่อเริ่มต้น</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-3">
                {getStatusIcon(data.status)}
                <span className="font-semibold text-gray-900 dark:text-white">
                  สถานะปัจจุบัน: {getStatusText(data.status)}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">ประวัติการส่ง (Versions)</h3>
              <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-3 md:ml-4 space-y-8">
                {data.versions.map((version, idx) => (
                  <div key={version.version_id} className="relative pl-6 md:pl-8">
                    <div className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white dark:border-gray-800 ${
                      version.status === 'approved' ? 'bg-green-500' :
                      version.status === 'rejected' ? 'bg-red-500' : 'bg-brand-blue'
                    }`} />
                    
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          เวอร์ชัน {data.versions.length - idx}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          {new Date(version.submitted_at).toLocaleString('th-TH')}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2 mb-4">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          version.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          version.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}>
                          {getStatusText(version.status)}
                        </span>
                      </div>

                      {version.rejection_comment && (
                        <div className="mt-3 p-4 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
                          <p className="text-sm text-red-800 dark:text-red-300 font-medium mb-1">ความคิดเห็น/ข้อเสนอแนะ:</p>
                          <p className="text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap">{version.rejection_comment}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportOutline;
