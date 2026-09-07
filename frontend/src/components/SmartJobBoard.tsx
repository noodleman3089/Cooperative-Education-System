import React, { useEffect, useState, useRef } from 'react';
import {
  Building2,
  MapPin,
  Search,
  Plus,
  Map as MapIcon,
  Briefcase,
} from 'lucide-react';
import PageSkeleton from './ui/Skeleton';
import api from '../services/api';
import type { Job, Company } from '../types/api';
import SelfFoundJobModal from './SelfFoundJobModal';
import LateReasonModal from './LateReasonModal';
import ConfirmDialog from './ui/ConfirmDialog';
import useLateWindow from '../hooks/useLateWindow';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import { Select } from './ui/Input';
import {
  googleMaps,
  type GeocoderResult,
  type GoogleMap,
  type MapMarker,
} from '../types/googleMaps';
import { loadGoogleMapsScript } from '../utils/googleMapsLoader';

const google = {
  get maps() {
    const maps = googleMaps();
    if (!maps) throw new Error('Google Maps API is not loaded');
    return maps;
  },
};

/** หมวดหมู่งานสำหรับตัวกรอง */
const JOB_CATEGORIES = [
  { value: '', label: 'ทุกสายงาน' },
  { value: 'web', label: 'พัฒนาเว็บ / ซอฟต์แวร์' },
  { value: 'network', label: 'เครือข่าย & คลาวด์' },
  { value: 'data', label: 'วิเคราะห์ข้อมูล & AI' },
  { value: 'other', label: 'สายงานอื่นๆ' },
];

/** ฟังก์ชันช่วยสกัดหมวดหมู่จากชื่องานและรายละเอียด */
function getJobCategory(job: Job): string {
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  if (text.includes('web') || text.includes('software') || text.includes('frontend') || text.includes('backend') || text.includes('fullstack') || text.includes('react') || text.includes('node') || text.includes('developer') || text.includes('พัฒนา')) {
    return 'web';
  }
  if (text.includes('network') || text.includes('system') || text.includes('cloud') || text.includes('infra') || text.includes('เครือข่าย') || text.includes('cisco')) {
    return 'network';
  }
  if (text.includes('data') || text.includes('ai') || text.includes('bi') || text.includes('analyst') || text.includes('ข้อมูล') || text.includes('python')) {
    return 'data';
  }
  return 'other';
}

/** ฟังก์ชันช่วยดึงอักษรย่อ 2 ตัวจากชื่อบริษัทสำหรับแสดงเป็น Avatar */
function getCompanyInitials(name?: string | null): string {
  if (!name) return 'CO';
  const clean = name.replace(/^(บริษัท|บจก\.|หจก\.)\s*/, '').trim();
  const words = clean.split(/\s+/);
  if (words.length >= 2) {
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  }
  return clean.substring(0, 2).toUpperCase();
}

/** จัดรูปแบบวันที่แบบย่อ พ.ศ. */
function formatShortDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

const SmartJobBoard: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtering states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showMap, setShowMap] = useState(false);

  // Application & Detail states
  const [selectedJobForDetail, setSelectedJobForDetail] = useState<Job | null>(null);
  const [pendingConfirmJob, setPendingConfirmJob] = useState<Job | null>(null);
  const [submittingIntent, setSubmittingIntent] = useState<number | null>(null);
  const [pendingLateJob, setPendingLateJob] = useState<Job | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Self-found placement states
  const [showSelfFoundModal, setShowSelfFoundModal] = useState(false);
  const [provinceList, setProvinceList] = useState<{ province_id: number; province_name_th: string }[]>([]);

  const [currentIntent, setCurrentIntent] = useState<{
    company_name_th?: string;
    status: string;
  } | null>(null);
  const [hasProfile, setHasProfile] = useState(true);

  const alertRef = useRef<HTMLDivElement | null>(null);
  const lateWindow = useLateWindow('intent_submission');

  const CLOSED_INTENT_STATUSES = ['rejected', 'company_rejected'];
  const blockingIntent =
    currentIntent && !CLOSED_INTENT_STATUSES.includes(currentIntent.status) ? currentIntent : null;

  const canApply = hasProfile && blockingIntent === null;

  // Google Maps States & Refs
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>('');
  const [mapsLoaded, setMapsLoaded] = useState<boolean>(false);
  const [mapsLoadError, setMapsLoadError] = useState<boolean>(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<GoogleMap | null>(null);
  const markersRef = useRef<MapMarker[]>([]);

  // Unique provinces for filtering
  const provinces = Array.from(new Set(companies.map((c) => c.province))).filter(Boolean);

  // Filter logic
  const filteredJobs = jobs.filter((job) => {
    const company = companies.find((c) => c.company_id === job.company_id);
    const matchesSearch =
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (job.company_name_th && job.company_name_th.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (job.description && job.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesProvince = !selectedProvince || (company && company.province === selectedProvince);
    const matchesCategory = !selectedCategory || getJobCategory(job) === selectedCategory;

    return matchesSearch && matchesProvince && matchesCategory;
  });

  const totalQuota = filteredJobs.reduce((sum, j) => sum + (j.quota || 0), 0);

  const loadData = async () => {
    try {
      setLoading(true);
      const [jobsData, companiesData, masterData, meResult] = await Promise.all([
        api.get('/jobs'),
        api.get('/companies'),
        api.get('/master-data').catch(() => ({ provinces: [], googleMapsApiKey: '' })),
        api.get('/students/dashboard').then(
          (d) => ({ ok: true as const, d }),
          (e) => ({ ok: false as const, e })
        ),
      ]);
      setJobs(jobsData || []);
      setCompanies(companiesData || []);
      setProvinceList(masterData.provinces || []);

      if (meResult.ok) {
        setHasProfile(true);
        setCurrentIntent(meResult.d?.activeIntent ?? null);
      } else if (getErrorStatus(meResult.e) === 404) {
        setHasProfile(false);
        setCurrentIntent(null);
      }
      if (masterData.googleMapsApiKey) {
        setGoogleMapsApiKey(masterData.googleMapsApiKey);
      }
    } catch (err) {
      console.error('Failed to load job board data:', err);
      setError('ไม่สามารถเรียกข้อมูลตำแหน่งงานและบริษัทได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (googleMapsApiKey) {
      loadGoogleMapsScript(
        googleMapsApiKey,
        () => setMapsLoaded(true),
        () => setMapsLoadError(true)
      );
    }
  }, [googleMapsApiKey]);

  // Google Maps Markers
  useEffect(() => {
    if (!mapsLoaded || !showMap || !mapRef.current) return;

    if (!googleMapRef.current) {
      googleMapRef.current = new google.maps.Map(mapRef.current, {
        center: { lat: 13.7563, lng: 100.5018 },
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
    }

    const map = googleMapRef.current;
    const geocoder = new google.maps.Geocoder();
    const bounds = new google.maps.LatLngBounds();

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const uniqueCompanies = Array.from(new Set(filteredJobs.map((j) => j.company_id)))
      .map((id) => {
        const comp = companies.find((c) => c.company_id === id);
        const jobsAtComp = filteredJobs.filter((j) => j.company_id === id);
        return { company: comp, jobs: jobsAtComp };
      })
      .filter((item) => item.company !== undefined);

    let activeMarkersCount = 0;

    uniqueCompanies.forEach(({ company, jobs: compJobs }) => {
      if (!company) return;
      const searchAddress = `${company.name_th}, ${company.district}, ${company.province}, ประเทศไทย`;

      geocoder.geocode({ address: searchAddress }, (results: GeocoderResult[] | null, status: string) => {
        if (status === 'OK' && results && results[0]) {
          const location = results[0].geometry?.location;
          if (!location) return;

          const marker = new google.maps.Marker({
            position: location,
            map: map,
            title: company.name_th,
            animation: google.maps.Animation.DROP,
          });

          const jobsListHtml = compJobs
            .map((j) => `<li style="font-size:12px; margin-bottom:4px;"><strong>${j.title}</strong></li>`)
            .join('');
          const contentString = `
            <div style="font-family: sans-serif; padding: 6px; max-width: 240px; color: #1f2937;">
              <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: bold; color: #1d4ed8;">${company.name_th}</h4>
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #4b5563;">${company.address} ${company.district} ${company.province}</p>
              <div style="border-top: 1px solid #e5e7eb; padding-top: 6px;">
                <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: bold; color: #374151;">ตำแหน่งงานที่เปิดรับ:</p>
                <ul style="margin: 0; padding-left: 16px;">${jobsListHtml}</ul>
              </div>
            </div>
          `;

          const infoWindow = new google.maps.InfoWindow({ content: contentString });
          marker.addListener('click', () => infoWindow.open(map, marker));

          markersRef.current.push(marker);
          bounds.extend(location);
          activeMarkersCount++;

          if (activeMarkersCount === uniqueCompanies.length) {
            map.fitBounds(bounds);
            if ((map.getZoom() ?? 0) > 15) map.setZoom(15);
          }
        }
      });
    });
  }, [mapsLoaded, showMap, filteredJobs, companies]);

  /** เริ่มกระบวนการยื่นสมัคร: ตรวจสอบความพร้อมและแสดง ConfirmDialog */
  const handleInitiateApply = (job: Job) => {
    if (!canApply || submittingIntent !== null) return;
    if (lateWindow.isLate) {
      setPendingLateJob(job);
      return;
    }
    setPendingConfirmJob(job);
  };

  /** ส่งคำขอสมัครงานจริงหลังยืนยันแล้ว */
  const handleApply = async (job: Job, lateReason?: string) => {
    if (submittingIntent !== null || !canApply) return;
    setSubmittingIntent(job.job_id);
    setError(null);
    setSubmitSuccess(null);

    try {
      const activeSemester = await api.get('/semesters/active');

      const payload = {
        company_id: job.company_id,
        semester_id: activeSemester.semester_id,
        job_id: job.job_id,
        late_reason: lateReason,
      };

      await api.post('/intents', payload);
      setPendingLateJob(null);
      setPendingConfirmJob(null);
      setSelectedJobForDetail(null);
      setSubmitSuccess(
        `ส่งใบสมัครไปยัง ${job.company_name_th || 'สถานประกอบการ'} เรียบร้อยแล้ว — พิมพ์แบบคำร้องไปให้ลงนาม แล้วอัปโหลดกลับที่หน้าแรก`
      );
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การยื่นความจำนงสมัครงานล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSubmittingIntent(null);
      requestAnimationFrame(() =>
        alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
    }
  };

  if (loading) {
    return <PageSkeleton variant="cards" />;
  }

  return (
    <div className="space-y-6 page-enter">
      {/* 1. Header & Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">หาที่ฝึกงานสหกิจศึกษา</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            กดการ์ดเพื่ออ่านคุณสมบัติและสวัสดิการอย่างละเอียด ก่อนกดยืนยันยื่นความจำนง
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowSelfFoundModal(true)}
            className="inline-flex items-center gap-2 py-2.5 px-4.5 rounded-xl border border-blue-600 bg-blue-50/80 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-950/60 text-blue-900 dark:text-blue-300 text-sm font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
            ระบุที่ฝึกงานด้วยตนเอง
          </button>
          <button
            type="button"
            onClick={() => setShowMap(!showMap)}
            className={`inline-flex items-center gap-2 py-2.5 px-4.5 rounded-xl border text-sm font-semibold transition-all shadow-sm ${
              showMap
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-700'
            }`}
          >
            <MapIcon className="w-4.5 h-4.5" />
            {showMap ? 'ซ่อนแผนที่พิกัด' : 'แผนที่สถานประกอบการ'}
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      <div ref={alertRef} className="empty:hidden space-y-4">
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={submitSuccess} />
      </div>

      {/* Blocking Status Alerts */}
      {!hasProfile && (
        <AlertBanner
          variant="info"
          message={
            <div className="space-y-2">
              <p className="font-bold">ยังยื่นความจำนงไม่ได้ — ต้องกรอกประวัตินักศึกษาก่อน</p>
              <p>ระบบต้องใช้ข้อมูลประวัติของคุณในการออกหนังสือถึงสถานประกอบการ</p>
              <Button
                size="sm"
                onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'profile' }))}
              >
                ไปกรอกประวัตินักศึกษา
              </Button>
            </div>
          }
        />
      )}

      {blockingIntent && (
        <AlertBanner
          variant="info"
          message={
            <div className="space-y-2">
              <p className="font-bold">คุณมีใบความจำนงที่ดำเนินการอยู่แล้ว</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{blockingIntent.company_name_th || 'สถานประกอบการที่ยื่นไว้'}</span>
                <StatusBadge status={blockingIntent.status} domain="intent" />
              </p>
              <p>
                ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา หากต้องการเปลี่ยนที่ ต้องรอผลของใบนี้ก่อน หรือติดต่ออาจารย์ที่ปรึกษา
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.dispatchEvent(new CustomEvent('navigate', { detail: 'dashboard' }))}
              >
                ดูความคืบหน้าที่หน้าแรก
              </Button>
            </div>
          }
        />
      )}

      {/* 2. Smart FilterBar */}
      <div className="bg-white dark:bg-gray-900 p-3.5 sm:p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="ค้นหาชื่องาน, ทักษะ หรือชื่อบริษัท..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:border-brand-blue text-gray-900 dark:text-white transition-all"
            />
          </div>

          <div className="w-full sm:w-56">
            <Select
              value={selectedProvince}
              onChange={(e) => setSelectedProvince(e.target.value)}
              className="w-full text-xs"
            >
              <option value="">ทุกจังหวัด</option>
              {provinces.map((prov) => (
                <option key={prov} value={prov}>
                  {prov}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-full sm:w-52">
            <Select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full text-xs"
            >
              {JOB_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 text-right whitespace-nowrap">
          พบ <strong className="text-gray-900 dark:text-white">{filteredJobs.length}</strong> ตำแหน่งงาน ({totalQuota} อัตรา)
        </span>
      </div>

      {/* 3. Google Maps Panel (Collapsible) */}
      {showMap && (
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-3 shadow-sm">
          <div
            ref={mapRef}
            className="h-80 sm:h-96 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 relative overflow-hidden"
          >
            {!mapsLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-blue border-t-transparent mb-2"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400">กำลังโหลดแผนที่พิกัด...</span>
              </div>
            )}
            {mapsLoadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                <span className="text-xs text-red-500 font-semibold mb-1">ไม่สามารถโหลดแผนที่ได้</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือการตั้งค่า Google Maps API Key
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {filteredJobs.map((j) => {
              const comp = companies.find((c) => c.company_id === j.company_id);
              return comp ? (
                <span
                  key={j.job_id}
                  className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-brand-blue font-semibold dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-300"
                >
                  {comp.name_th} ({comp.province})
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* 4. Compact Job Cards Grid */}
      {filteredJobs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredJobs.map((job) => {
            const company = companies.find((c) => c.company_id === job.company_id);
            const remainingQuota = job.quota - job.applied_count;
            const isExpired = job.expire_date ? new Date(job.expire_date) < new Date() : false;
            const isClosed = remainingQuota <= 0 || isExpired;
            const initials = getCompanyInitials(company?.name_th || job.company_name_th);

            return (
              <div
                key={job.job_id}
                onClick={() => setSelectedJobForDetail(job)}
                className={`bg-white dark:bg-gray-900 rounded-2xl border transition-all flex flex-col justify-between p-5 cursor-pointer shadow-sm ${
                  isClosed
                    ? 'opacity-70 border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50'
                    : 'border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md hover:-translate-y-0.5'
                }`}
              >
                <div className="space-y-3.5">
                  {/* Company row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-brand-navy dark:text-blue-300 font-bold flex items-center justify-center text-sm shrink-0 border border-blue-100 dark:border-blue-900/60">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate block">
                          {company?.name_th || job.company_name_th}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                          {company?.district ? `${company.district}, ` : ''}{company?.province || 'ไม่ระบุจังหวัด'}
                        </span>
                      </div>
                    </div>

                    {company?.is_verified ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900 shrink-0">
                        ✓ รับรอง
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0">
                        พันธมิตร
                      </span>
                    )}
                  </div>

                  {/* Title & Category */}
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-brand-blue">
                      {job.title}
                    </h3>
                    <span className="text-xs text-brand-blue dark:text-blue-400 font-medium block mt-0.5">
                      {JOB_CATEGORIES.find((c) => c.value === getJobCategory(job))?.label || 'งานทั่วไป'}
                    </span>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-brand-navy border border-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900">
                      <Briefcase className="w-3 h-3" />
                      สหกิจศึกษา
                    </span>
                    {company?.province && (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-200/60 dark:border-gray-700/60">
                        {company.province}
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer of Card */}
                <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
                  <div className="text-xs">
                    {isClosed ? (
                      <span className="font-bold text-red-600 dark:text-red-400">โควตาเต็มแล้ว</span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">
                        เหลือ <strong className="text-green-700 dark:text-green-400 font-bold">{remainingQuota}</strong> จาก {job.quota} คน
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      data-testid="view-job-detail"
                      onClick={() => setSelectedJobForDetail(job)}
                      className="px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800/80 bg-blue-50/60 dark:bg-blue-950/30 text-brand-navy dark:text-blue-300 text-xs font-semibold hover:bg-blue-100/60 dark:hover:bg-blue-900/40 transition-all"
                    >
                      ดูรายละเอียด
                    </button>

                    <button
                      type="button"
                      data-testid="apply-job"
                      onClick={() => handleInitiateApply(job)}
                      disabled={isClosed || !canApply || submittingIntent !== null}
                      title={
                        isClosed
                          ? undefined
                          : !hasProfile
                            ? 'ต้องกรอกประวัตินักศึกษาก่อนจึงจะยื่นความจำนงได้'
                            : blockingIntent
                              ? 'ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา'
                              : undefined
                      }
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                        isClosed || !canApply
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-500'
                          : 'bg-brand-blue hover:bg-blue-600 text-white hover:shadow-md'
                      }`}
                    >
                      {isClosed
                        ? 'ปิดรับ'
                        : !canApply
                          ? 'ยื่นไม่ได้'
                          : submittingIntent === job.job_id
                            ? 'กำลังยื่น...'
                            : 'ยื่นความจำนง'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-14 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 text-sm space-y-2">
          <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto" />
          <p className="font-semibold text-gray-700 dark:text-gray-300">ไม่พบข้อมูลตำแหน่งงานที่สอดคล้องกับการค้นหา</p>
          <p className="text-xs text-gray-400">ลองเปลี่ยนคำค้นหา หรือเลือกตัวกรองจังหวัดและสายงานอื่น</p>
        </div>
      )}

      {/* 5. Self-Found Placement Banner */}
      <div className="bg-white dark:bg-gray-900 border border-dashed border-blue-600/70 dark:border-blue-500/50 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/60">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-base font-bold text-gray-900 dark:text-white">ติดต่อสถานประกอบการด้วยตนเองไว้อยู่แล้ว?</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              กรอกข้อมูลบริษัทเพื่อให้เจ้าหน้าที่ตรวจสอบและออกหนังสือขอความอนุเคราะห์
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowSelfFoundModal(true)}
          className="inline-flex items-center gap-2 px-4.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-all shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4" />
          กรอกข้อมูลที่ฝึกงานที่หาเอง
        </button>
      </div>

      {/* 6. Job Detail Modal */}
      {selectedJobForDetail && (
        <Modal
          onClose={() => setSelectedJobForDetail(null)}
          size="lg"
          title={
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950 text-brand-navy dark:text-blue-300 font-bold flex items-center justify-center text-sm shrink-0 border border-blue-200 dark:border-blue-800">
                {getCompanyInitials(
                  companies.find((c) => c.company_id === selectedJobForDetail.company_id)?.name_th ||
                    selectedJobForDetail.company_name_th
                )}
              </div>
              <div className="min-w-0 text-left">
                <h3 className="text-base font-bold text-gray-900 dark:text-white truncate">
                  {selectedJobForDetail.title}
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400 block truncate">
                  {companies.find((c) => c.company_id === selectedJobForDetail.company_id)?.name_th ||
                    selectedJobForDetail.company_name_th}
                </span>
              </div>
            </div>
          }
        >
          <ModalBody>
            {(() => {
              const comp = companies.find((c) => c.company_id === selectedJobForDetail.company_id);
              const remaining = selectedJobForDetail.quota - selectedJobForDetail.applied_count;
              const isClosed = remaining <= 0 || (selectedJobForDetail.expire_date ? new Date(selectedJobForDetail.expire_date) < new Date() : false);

              return (
                <div className="space-y-5">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-gray-50 dark:bg-gray-800/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700">
                    <div>
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 block uppercase">
                        สถานที่ปฏิบัติงาน
                      </span>
                      <span className="text-xs font-bold text-gray-900 dark:text-white block mt-0.5 truncate">
                        {comp?.district ? `${comp.district}, ` : ''}{comp?.province || '-'}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 block uppercase">
                        โควตาคงเหลือ
                      </span>
                      <span className={`text-xs font-bold block mt-0.5 ${isClosed ? 'text-red-600' : 'text-green-600 dark:text-green-400'}`}>
                        {isClosed ? 'เต็มแล้ว' : `เหลือ ${remaining} จาก ${selectedJobForDetail.quota} คน`}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 block uppercase">
                        หมดเขตรับสมัคร
                      </span>
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-400 block mt-0.5">
                        {formatShortDate(selectedJobForDetail.expire_date)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 block uppercase">
                        สถานะการรับรอง
                      </span>
                      <span className="text-xs font-bold text-brand-blue dark:text-blue-400 block mt-0.5">
                        {comp?.is_verified ? '✓ รับรองแล้ว' : 'สถานประกอบการทั่วไป'}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                      ลักษณะงานและความรับผิดชอบ
                    </h4>
                    <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line bg-white dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
                      {selectedJobForDetail.description || 'ไม่มีรายละเอียดเพิ่มเติมระบุไว้สำหรับตำแหน่งนี้'}
                    </p>
                  </div>

                  {/* Company info */}
                  {comp && (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">
                        ข้อมูลสถานที่ตั้งสถานประกอบการ
                      </h4>
                      <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50/70 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800 space-y-1">
                        <p className="font-semibold text-gray-800 dark:text-gray-200">{comp.name_th}</p>
                        <p>{comp.address} {comp.district} จ.{comp.province} {comp.postal_code}</p>
                        {comp.phone && <p>เบอร์ติดต่อ: {comp.phone}</p>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </ModalBody>

          <ModalFooter>
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ยื่นได้ 1 แห่งต่อภาคการศึกษา
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setSelectedJobForDetail(null)}>
                  ปิดหน้าต่าง
                </Button>
                {(() => {
                  const remaining = selectedJobForDetail.quota - selectedJobForDetail.applied_count;
                  const isClosed = remaining <= 0 || (selectedJobForDetail.expire_date ? new Date(selectedJobForDetail.expire_date) < new Date() : false);

                  return (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isClosed || !canApply || submittingIntent !== null}
                      onClick={() => handleInitiateApply(selectedJobForDetail)}
                    >
                      {isClosed ? 'ปิดรับสมัครแล้ว' : 'ยื่นความจำนงสมัครตำแหน่งนี้'}
                    </Button>
                  );
                })()}
              </div>
            </div>
          </ModalFooter>
        </Modal>
      )}

      {/* 7. Level 1 ConfirmDialog */}
      {pendingConfirmJob && (
        <ConfirmDialog
          open={true}
          title="ยืนยันเลือกสถานประกอบการ"
          confirmLabel="เลือกที่นี่"
          cancelLabel="ยกเลิก"
          onCancel={() => setPendingConfirmJob(null)}
          onConfirm={() => handleApply(pendingConfirmJob)}
          busy={submittingIntent !== null}
          message={
            <div className="space-y-3">
              <p>
                เลือกที่นี่แล้วระบบจะเริ่มเดินเรื่องขอหนังสือให้ คุณสามารถเปลี่ยนใจได้จนกว่าเจ้าหน้าที่จะออกเลขหนังสือ
              </p>
              <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">สถานประกอบการ:</span>
                  <span className="font-semibold text-gray-900 dark:text-white text-right">
                    {pendingConfirmJob.company_name_th || 'สถานประกอบการที่เลือก'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500">ตำแหน่งงาน:</span>
                  <span className="font-semibold text-gray-900 dark:text-white text-right">
                    {pendingConfirmJob.title}
                  </span>
                </div>
              </div>
            </div>
          }
        />
      )}

      {/* 8. Self-Found Placement Modal */}
      <SelfFoundJobModal
        isOpen={showSelfFoundModal}
        onClose={() => setShowSelfFoundModal(false)}
        onSuccess={(msg) => {
          setSubmitSuccess(msg);
          setShowSelfFoundModal(false);
          loadData();
        }}
        provinceList={provinceList}
        mapsLoaded={mapsLoaded}
      />

      {/* 9. Late Window Reason Modal */}
      {pendingLateJob && (
        <LateReasonModal
          lateEndDate={lateWindow.lateEndDate}
          submitting={submittingIntent !== null}
          onCancel={() => setPendingLateJob(null)}
          onConfirm={(reason) => handleApply(pendingLateJob, reason)}
        />
      )}
    </div>
  );
};

export default SmartJobBoard;
