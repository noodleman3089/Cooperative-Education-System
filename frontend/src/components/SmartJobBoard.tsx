import React, { useEffect, useState, useRef } from 'react';
import PageSkeleton from './ui/Skeleton';
import api from '../services/api';
import type { Job, Company } from '../types/api';
import SelfFoundJobModal from './SelfFoundJobModal';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import StatusBadge from './ui/StatusBadge';
import { getErrorMessage, getErrorStatus } from '../utils/errors';
import { Select } from './ui/Input';
import {
  googleMaps,
  type GeocoderResult,
  type GoogleMap,
  type MapMarker,
} from '../types/googleMaps';

/**
 * ทางเข้า Google Maps ที่ TypeScript ตรวจได้ แทน `declare const google: any` เดิม
 * โค้ดด้านล่างเรียก `google.maps.X` อยู่ 8 จุด ซึ่งทุกจุดอยู่หลังการตรวจ
 * `mapsLoaded` แล้ว การ throw ตรงนี้จึงเป็นตาข่ายกันพลาด ไม่ใช่เส้นทางปกติ
 */
const google = {
  get maps() {
    const maps = googleMaps();
    if (!maps) throw new Error('Google Maps API is not loaded');
    return maps;
  },
};

const loadGoogleMapsScript = (apiKey: string, onLoad: () => void, onError: () => void) => {
  if (!apiKey) {
    onError();
    return;
  }
  if (googleMaps()) {
    onLoad();
    return;
  }
  const existingScript = document.getElementById('google-maps-script');
  if (existingScript) {
    const handleLoad = () => onLoad();
    existingScript.addEventListener('load', handleLoad);
    return;
  }
  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=th`;
  script.async = true;
  script.defer = true;
  script.onload = () => onLoad();
  script.onerror = () => onError();
  document.body.appendChild(script);
};

const SmartJobBoard: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filtering states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [submittingIntent, setSubmittingIntent] = useState<number | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Self-found placement states
  const [showSelfFoundModal, setShowSelfFoundModal] = useState(false);
  const [provinceList, setProvinceList] = useState<{ province_id: number; province_name_th: string }[]>([]);

  /**
   * The board used to know nothing about the student looking at it. A student
   * who had already applied — the system allows exactly one live intent per
   * semester — saw every card offering a bright "ยื่นความจำนง", clicked, and
   * only then learned it was not allowed. Now the rule is visible before the
   * click rather than explained after it.
   */
  const [currentIntent, setCurrentIntent] = useState<{
    company_name_th?: string;
    status: string;
  } | null>(null);
  const [hasProfile, setHasProfile] = useState(true);

  // The alert lives at the top of the page and the cards run well below the
  // fold, so on a long board the answer to a click could land off-screen.
  const alertRef = useRef<HTMLDivElement | null>(null);

  /**
   * Mirrors the server's rule in models/intent.ts: a form in one of these three
   * states is finished with, and the student is free to apply somewhere else.
   *
   * This is decided here rather than taken from the endpoint because the
   * endpoint's `activeIntent` means something slightly different — it omits
   * only 'rejected' and 'company_rejected', so a form the department head sent
   * back still comes through, on purpose, so the dashboard can show the student
   * what happened to it. Reusing that as "you may not apply" would have locked
   * out exactly the students who need to apply again.
   */
  const CLOSED_INTENT_STATUSES = ['rejected', 'company_rejected', 'rejected_by_dept_head'];
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

  // Get unique provinces from companies list for filtering dropdown
  const provinces = Array.from(new Set(companies.map(c => c.province))).filter(Boolean);

  // Filter logic
  const filteredJobs = jobs.filter(job => {
    const company = companies.find(c => c.company_id === job.company_id);
    const matchesSearch = job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (job.company_name_th && job.company_name_th.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesProvince = !selectedProvince || (company && company.province === selectedProvince);

    return matchesSearch && matchesProvince;
  });

  const loadData = async () => {
    try {
      setLoading(true);
      // The dashboard call is the student's own record — GET /intents is 403
      // for a student by design, so this is the only way the board can learn
      // whether they already have one open. Settled separately so a student
      // with no profile still gets a browsable board.
      const [jobsData, companiesData, masterData, meResult] = await Promise.all([
        api.get('/jobs'),
        api.get('/companies'),
        api.get('/master-data').catch(() => ({ provinces: [], googleMapsApiKey: '' })),
        api.get('/students/dashboard').then(
          (d) => ({ ok: true as const, d }),
          (e) => ({ ok: false as const, e })
        )
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

  // Interactive Maps Effect
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

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const uniqueCompanies = Array.from(new Set(filteredJobs.map(j => j.company_id)))
      .map(id => {
        const comp = companies.find(c => c.company_id === id);
        const jobsAtComp = filteredJobs.filter(j => j.company_id === id);
        return { company: comp, jobs: jobsAtComp };
      })
      .filter(item => item.company !== undefined);

    let activeMarkersCount = 0;

    uniqueCompanies.forEach(({ company, jobs }) => {
      if (!company) return;
      const searchAddress = `${company.name_th}, ${company.district}, ${company.province}, ประเทศไทย`;

      geocoder.geocode({ address: searchAddress }, (results: GeocoderResult[] | null, status: string) => {
        if (status === 'OK' && results && results[0]) {
          const location = results[0].geometry.location;
          
          const marker = new google.maps.Marker({
            position: location,
            map: map,
            title: company.name_th,
            animation: google.maps.Animation.DROP,
          });

          const jobsListHtml = jobs.map(j => `<li style="font-size:12px; margin-bottom:4px;"><strong>${j.title}</strong></li>`).join('');
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

          const infoWindow = new google.maps.InfoWindow({
            content: contentString,
          });

          marker.addListener('click', () => {
            infoWindow.open(map, marker);
          });

          markersRef.current.push(marker);
          bounds.extend(location);
          activeMarkersCount++;

          if (activeMarkersCount === uniqueCompanies.length) {
            map.fitBounds(bounds);
            if (map.getZoom()! > 15) {
              map.setZoom(15);
            }
          }
        } else {
          const generalAddress = `${company.district}, ${company.province}, ประเทศไทย`;
          geocoder.geocode({ address: generalAddress }, (generalResults: GeocoderResult[] | null, generalStatus: string) => {
            if (generalStatus === 'OK' && generalResults && generalResults[0]) {
              const location = generalResults[0].geometry.location;
              const marker = new google.maps.Marker({
                position: location,
                map: map,
                title: company.name_th,
                animation: google.maps.Animation.DROP,
              });

              const jobsListHtml = jobs.map(j => `<li style="font-size:12px; margin-bottom:4px;"><strong>${j.title}</strong></li>`).join('');
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

              const infoWindow = new google.maps.InfoWindow({
                content: contentString,
              });

              marker.addListener('click', () => {
                infoWindow.open(map, marker);
              });

              markersRef.current.push(marker);
              bounds.extend(location);
              activeMarkersCount++;

              if (activeMarkersCount === uniqueCompanies.length) {
                map.fitBounds(bounds);
                if (map.getZoom()! > 15) {
                  map.setZoom(15);
                }
              }
            }
          });
        }
      });
    });

  }, [mapsLoaded, showMap, filteredJobs, companies]);

  const handleApply = async (job: Job) => {
    if (submittingIntent !== null || !canApply) return;
    setSubmittingIntent(job.job_id);
    setError(null);
    setSubmitSuccess(null);

    try {
      const activeSemester = await api.get('/semesters/active');
      
      const payload = {
        company_id: job.company_id,
        semester_id: activeSemester.semester_id,
        job_id: job.job_id
      };

      await api.post('/intents', payload);
      setSubmitSuccess(`ส่งใบสมัครไปยัง ${job.company_name_th} เรียบร้อยแล้ว (รอการยืนยันจากอาจารย์)`);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'การยื่นความจำนงสมัครงานล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSubmittingIntent(null);
      // Whichever way it went, put the answer where the eye is. Without this a
      // student who clicked a card far down the list sees the page apparently
      // do nothing.
      requestAnimationFrame(() =>
        alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
    }
  };

  if (loading) {
    return (
      <PageSkeleton variant='cards' />
    );
  }

  return (
    <div className="space-y-6 page-enter">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">บอร์ดหาตำแหน่งงานสหกิจศึกษา</h2>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            ค้นหา ตรวจสอบพิกัดบริษัท และกดยื่นใบความจำนงออนไลน์
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowSelfFoundModal(true)}
            className="flex items-center gap-1.5 py-2 px-4 rounded-xl border border-brand-blue text-brand-navy dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20 text-xs font-bold transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            ระบุสถานที่ฝึกงานด้วยตนเอง
          </button>
          <button
            type="button"
            onClick={() => setShowMap(!showMap)}
            className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-brand-blue hover:bg-blue-600 text-white text-xs font-bold transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            {showMap ? 'ซ่อนแผนที่พิกัด' : 'แสดงตำแหน่งบนแผนที่'}
          </button>
        </div>
      </div>

      <div ref={alertRef} className="empty:hidden space-y-6">
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={submitSuccess} />
      </div>

      {/* Why the buttons below are off, said once and up front rather than as
          an error after the click. */}
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
                <StatusBadge status={blockingIntent.status} />
              </p>
              <p>
                ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา หากต้องการเปลี่ยนที่ ต้องรอผลของใบนี้ก่อน
                หรือให้อาจารย์ที่ปรึกษาตีกลับใบเดิม
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

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800">
        <input
          type="text"
          placeholder="ค้นหาตามชื่องาน หรือ ชื่อบริษัท..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"
        />
        <Select
          value={selectedProvince}
          onChange={(e) => setSelectedProvince(e.target.value)}
        >
          <option value="">กรองตามจังหวัดทั้งหมด</option>
          {provinces.map((prov) => (
            <option key={prov} value={prov}>
              {prov}
            </option>
          ))}
        </Select>
      </div>

      {/* Dynamic Google Maps Panel */}
      {showMap && (
        <div className="bg-white p-4 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-3">
          <div 
            ref={mapRef} 
            className="h-96 rounded-xl bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 relative overflow-hidden"
          >
            {!mapsLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-blue border-t-transparent mb-2"></div>
                <span className="text-xs text-gray-500 dark:text-gray-400">กำลังโหลดแผนที่...</span>
              </div>
            )}
            {mapsLoadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                <span className="text-xs text-red-500 font-semibold mb-1">ไม่สามารถโหลดแผนที่ได้</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือความถูกต้องของ API Key</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {filteredJobs.map(j => {
              const comp = companies.find(c => c.company_id === j.company_id);
              return comp ? (
                <span key={j.job_id} className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-brand-blue font-semibold dark:bg-blue-950/20 dark:border-blue-900 dark:text-blue-400">
                  {comp.name_th} ({comp.province})
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Jobs Grid */}
      {filteredJobs.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredJobs.map((job) => {
            const company = companies.find(c => c.company_id === job.company_id);
            const remainingQuota = job.quota - job.applied_count;
            const isClosed = remainingQuota <= 0 || new Date(job.expire_date) < new Date();

            return (
              <div key={job.job_id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex flex-col justify-between hover:shadow-lg transition-all dark:bg-gray-900 dark:border-gray-800">
                <div className="p-6 space-y-4">
                  <div>
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block">
                      {company?.name_th}
                    </span>
                    <h3 className="text-base font-bold text-gray-800 dark:text-white mt-1">
                      {job.title}
                    </h3>
                  </div>
                  
                  <p className="text-xs text-gray-500 line-clamp-3 dark:text-gray-400">
                    {job.description}
                  </p>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      พื้นที่: {company?.province} / {company?.district}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      โควตาคงเหลือ: {remainingQuota} จาก {job.quota} อัตรา
                    </span>
                  </div>
                </div>

                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between dark:bg-gray-900/40 dark:border-gray-800">
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    หมดเขต: {new Date(job.expire_date).toLocaleDateString('th-TH')}
                  </span>
                  
                  <button
                    type="button"
                    // Its label changes with state (ปิดรับสมัคร / กำลังยื่น...),
                    // which is exactly why tests should not select it by text.
                    data-testid="apply-job"
                    onClick={() => handleApply(job)}
                    disabled={isClosed || !canApply || submittingIntent !== null}
                    // The banner above carries the full explanation; this is for
                    // anyone who scrolled straight past it to a card.
                    title={
                      isClosed
                        ? undefined
                        : !hasProfile
                          ? 'ต้องกรอกประวัตินักศึกษาก่อนจึงจะยื่นความจำนงได้'
                          : blockingIntent
                            ? 'ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา'
                            : undefined
                    }
                    className={`py-1.5 px-4 rounded-lg text-xs font-bold transition-all shadow-sm ${
                      isClosed || !canApply
                        ? 'bg-gray-100 text-gray-500 cursor-not-allowed dark:bg-gray-800 dark:text-gray-400'
                        : 'bg-brand-blue hover:bg-blue-600 text-white hover:shadow-md'
                    }`}
                  >
                    {isClosed
                      ? 'ปิดรับสมัคร'
                      : !canApply
                        ? 'ยื่นไม่ได้ขณะนี้'
                        : submittingIntent === job.job_id
                          ? 'กำลังยื่น...'
                          : 'ยื่นความจำนง'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 text-gray-600 dark:text-gray-400 text-sm dark:bg-gray-900 dark:border-gray-800">
          ไม่พบข้อมูลตำแหน่งงานที่สอดคล้องกับการคัดกรองในขณะนี้
        </div>
      )}
    </div>
  );
};

export default SmartJobBoard;
