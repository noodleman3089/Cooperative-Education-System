import React, { useEffect, useRef, useState } from 'react';
import { MapPin, LoaderCircle } from 'lucide-react';
import api from '../../services/api';
import {
  googleMaps,
  type AddressComponent,
  type GoogleMap,
  type MapMarker,
} from '../../types/googleMaps';
import { loadGoogleMapsScript } from '../../utils/googleMapsLoader';

/**
 * "แผนที่แสดงตำแหน่งที่ตั้ง" ของ สหกิจ 06 — บนกระดาษเป็นกรอบให้วาดมือ
 *
 * ฟอร์มจริงมีกรอบนี้ไว้ให้**อาจารย์นิเทศใช้ตอนออกนิเทศ** ระบบจึงแทนด้วยหมุดที่
 * นักศึกษาปักเอง แล้วเก็บพิกัดไว้ · ฝั่งอาจารย์เห็นเป็น**ลิงก์**เปิด Google Maps
 * ไม่ใช่แผนที่ฝัง (เจ้าของเคาะไว้ใน `design_student_address_map.md` — แผนที่ฝัง
 * กินโควตา API ทุกครั้งที่เปิดหน้า ทั้งที่อาจารย์ต้องดูจริงแค่ตอนวางแผนเดินทาง)
 *
 * ⛔ **แผนที่เป็นตัวช่วย ไม่ใช่เงื่อนไขของฟอร์ม** — โหลดไม่ขึ้น (API key หมดโควตา
 * เน็ตองค์กรบล็อก) ต้องยังกรอกที่อยู่และส่งฟอร์มได้ตามปกติ
 */

const THAILAND_CENTER = { lat: 13.7563, lng: 100.5018 };

interface Props {
  /** ค่าที่เก็บอยู่ — สตริงว่างแปลว่ายังไม่ได้ปักหมุด */
  latitude: string;
  longitude: string;
  /** เรียกเมื่อหมุดถูกวาง/ย้าย · `components` คือชิ้นส่วนที่อยู่จาก Google (อาจว่าง) */
  onPick: (lat: number, lng: number, components: AddressComponent[]) => void;
}

const AccommodationMapPicker: React.FC<Props> = ({ latitude, longitude, onPick }) => {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const markerRef = useRef<MapMarker | null>(null);
  /**
   * onPick เปลี่ยน identity ทุก render ของหน้าแม่ แต่ listener ของแผนที่ถูกผูก
   * ครั้งเดียว — ถ้าไม่ผ่าน ref มันจะเรียกตัวเก่าที่ปิดทับ state เก่าไว้ตลอดกาล
   */
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const [apiKey, setApiKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resolving, setResolving] = useState(false);

  const hasPin = latitude !== '' && longitude !== '';

  useEffect(() => {
    api
      .get('/master-data')
      .then((d) => {
        if (d?.googleMapsApiKey) setApiKey(d.googleMapsApiKey);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    loadGoogleMapsScript(apiKey, () => setLoaded(true), () => setFailed(true));
  }, [apiKey]);

  /**
   * หาที่อยู่จากพิกัด (reverse geocoding) แล้วส่งชิ้นส่วนกลับให้ฟอร์มไปจับคู่เอง
   *
   * ⛔ **ยิงเฉพาะตอนหมุดถูกวาง ไม่ใช่ทุกครั้งที่แผนที่ขยับ** — ทุกครั้งที่เรียกคือ
   * หนึ่งครั้งในโควตาที่มหาวิทยาลัยจ่าย · ล้มเหลวก็ยังได้พิกัด ซึ่งเป็นของหลัก
   */
  const placePin = (lat: number, lng: number) => {
    const maps = googleMaps();
    if (!maps) {
      onPickRef.current(lat, lng, []);
      return;
    }
    setResolving(true);
    new maps.Geocoder().geocode({ location: { lat, lng } }, (results, status) => {
      setResolving(false);
      const components =
        status === 'OK' && results && results[0]?.address_components
          ? results[0].address_components
          : [];
      onPickRef.current(lat, lng, components);
    });
  };

  useEffect(() => {
    if (!loaded || !mapDivRef.current) return;
    const maps = googleMaps();
    if (!maps) return;

    const center = hasPin ? { lat: Number(latitude), lng: Number(longitude) } : THAILAND_CENTER;

    if (!mapRef.current) {
      mapRef.current = new maps.Map(mapDivRef.current, {
        center,
        zoom: hasPin ? 16 : 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      });
      // คลิกที่ไหนก็วางหมุดที่นั่น — ง่ายกว่าการลากบนจอสัมผัส
      mapRef.current.addListener('click', (e) => {
        const pos = e?.latLng;
        if (pos) placePin(pos.lat(), pos.lng());
      });
    }

    if (hasPin) {
      const position = { lat: Number(latitude), lng: Number(longitude) };
      if (!markerRef.current) {
        markerRef.current = new maps.Marker({
          position,
          map: mapRef.current,
          draggable: true,
        });
        markerRef.current.addListener('dragend', () => {
          const pos = markerRef.current?.getPosition();
          if (pos) placePin(pos.lat(), pos.lng());
        });
      } else {
        markerRef.current.setPosition(position);
      }
      mapRef.current.setCenter(position);
    }
    // ตั้งใจไม่ผูก placePin/hasPin — effect นี้สร้างแผนที่ครั้งเดียวแล้วซิงก์ตำแหน่งหมุด
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, latitude, longitude]);

  if (failed) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
        ไม่สามารถโหลดแผนที่ได้ — กรอกที่อยู่ตามช่องด้านบนได้ตามปกติ
        ระบบจะไม่มีพิกัดสำหรับให้อาจารย์นิเทศเปิดนำทางเท่านั้น
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={mapDivRef}
        data-testid="accommodation-map"
        className="h-64 w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800"
      >
        {!loaded && (
          <div className="flex h-full items-center justify-center text-xs text-gray-500 dark:text-gray-400">
            กำลังโหลดแผนที่...
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        {resolving ? (
          <>
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            กำลังอ่านที่อยู่จากหมุด...
          </>
        ) : hasPin ? (
          <>
            <MapPin className="h-3.5 w-3.5 text-brand-blue" />
            <span data-testid="accommodation-pin">
              ปักหมุดแล้วที่ {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)} —
              คลิกที่อื่นหรือลากหมุดเพื่อย้าย
            </span>
          </>
        ) : (
          <>
            <MapPin className="h-3.5 w-3.5" />
            คลิกบนแผนที่เพื่อปักหมุดที่พัก (ไม่บังคับ แต่ช่วยให้อาจารย์นิเทศหาทางไปถูก)
          </>
        )}
      </p>
    </div>
  );
};

export default AccommodationMapPicker;
