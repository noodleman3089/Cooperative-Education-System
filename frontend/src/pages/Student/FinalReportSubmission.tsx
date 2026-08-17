import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api, { API_BASE_URL } from '../../services/api';
import { FileUp, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';

interface Version {
  report_id: number;
  file_path: string;
  submitted_at: string;
  rejection_comment: string | null;
  status: string;
  reviewer_email: string | null;
  version: number;
}

const FinalReportSubmission: React.FC = () => {
  const auth = useContext(AuthContext);
  const [versions, setVersions] = useState<Version[]>([]);
  const [isOutlineApproved, setIsOutlineApproved] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSubmissionData = async () => {
      if (!auth?.user) return;
      try {
        setLoading(true);
        setError(null);

        // 1. Check if report outline is approved
        const outlineResult = await api.get(`/outlines/student/${auth.user.userId}`);
        const outlineApproved = outlineResult.data?.status === 'approved';
        setIsOutlineApproved(outlineApproved);

        // 2. Fetch final report submission history
        const reportResult = await api.get('/final-reports/my-report');
        setVersions(reportResult.data || []);
      } catch (err) {
        setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการโหลดข้อมูล'));
      } finally {
        setLoading(false);
      }
    };

    fetchSubmissionData();
  }, [auth?.user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('กรุณาอัปโหลดไฟล์ PDF เท่านั้น');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('ขนาดไฟล์ต้องไม่เกิน 20MB');
      return;
    }

    try {
      setUploading(true);
      setError(null);
      const formData = new FormData();
      formData.append('report', file);

      await api.post('/final-reports', formData);

      // Refetch report history
      const reportResult = await api.get('/final-reports/my-report');
      setVersions(reportResult.data || []);
      
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
      default: return 'รออาจารย์นิเทศตรวจสอบ';
    }
  };

  // The latest status is the status of the first version in the sorted array (which is sorted version DESC)
  const currentStatus = versions.length > 0 ? versions[0].status : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">ส่งรายงานฉบับสมบูรณ์ (Final Report)</h1>
            <p className="text-gray-500 dark:text-gray-400">อัปโหลดรายงานสหกิจศึกษาฉบับสมบูรณ์ (ไฟล์ PDF) เพื่อรับการประเมินขั้นสุดท้าย</p>
          </div>

          <div className="mt-4 md:mt-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              className="hidden"
              accept=".pdf"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !isOutlineApproved || currentStatus === 'approved'}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all duration-200 shadow-sm
                ${uploading || !isOutlineApproved || currentStatus === 'approved'
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500'
                  : 'bg-brand-blue hover:bg-blue-600 text-white hover:shadow-md hover:shadow-blue-500/20 active:scale-95'}`}
            >
              {uploading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <FileUp className="w-5 h-5" />
              )}
              <span>{uploading ? 'กำลังอัปโหลด...' : 'อัปโหลดรายงานสมบูรณ์'}</span>
            </button>
          </div>
        </div>

        <AlertBanner variant="error" message={error} className="mb-6" />

        {!isOutlineApproved && !loading && (
          <div className="mb-6 flex items-start gap-3 p-4 text-orange-700 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-400 rounded-xl border border-orange-100 dark:border-orange-800">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold mb-1">ไม่สามารถส่งรายงานได้</p>
              <p className="text-sm">นักศึกษาต้องผ่านการอนุมัติโครงร่างรายงาน สหกิจ 11 จากอาจารย์ที่ปรึกษาในขั้นตอนก่อนหน้าให้เรียบร้อยก่อนจึงจะทำการส่งเล่มสมบูรณ์ได้</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
          </div>
        ) : versions.length === 0 ? (
          <div className="py-16 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl bg-gray-50 dark:bg-gray-800/50">
            <FileUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">ยังไม่มีการส่งเล่มรายงานสมบูรณ์</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">อัปโหลดรายงานฉบับสมบูรณ์เป็นไฟล์ PDF (ขนาดไม่เกิน 20MB)</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-600">
              <div className="flex items-center gap-3">
                {getStatusIcon(versions[0].status)}
                <span className="font-semibold text-gray-900 dark:text-white">
                  สถานะปัจจุบัน: {getStatusText(versions[0].status)}
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6">ประวัติการส่งเล่ม (Versions)</h3>
              <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-3 md:ml-4 space-y-8">
                {versions.map((version) => (
                  <div key={version.report_id} className="relative pl-6 md:pl-8">
                    <div className={`absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white dark:border-gray-800 ${
                      version.status === 'approved' ? 'bg-green-500' :
                      version.status === 'rejected' ? 'bg-red-500' : 'bg-brand-blue'
                    }`} />
                    
                    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          เวอร์ชัน {version.version}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          {new Date(version.submitted_at).toLocaleString('th-TH')}
                        </span>
                      </div>
                      
                      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            version.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            version.status === 'rejected' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {getStatusText(version.status)}
                          </span>
                        </div>
                        {/* Same dead /uploads/ link the advisor's screen had —
                            a student could not reopen the report they had just
                            submitted. */}
                        <a
                          href={`${API_BASE_URL}/files/${version.file_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-blue hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          เปิดไฟล์รายงาน PDF
                        </a>
                      </div>

                      {version.rejection_comment && (
                        <div className="mt-3 p-4 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/30">
                          <p className="text-sm text-red-800 dark:text-red-300 font-medium mb-1">ความคิดเห็น/ข้อแนะนำเพื่อแก้ไข:</p>
                          <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">{version.rejection_comment}</p>
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

export default FinalReportSubmission;
