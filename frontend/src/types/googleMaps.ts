/**
 * ชนิดข้อมูลของ Google Maps JavaScript API เท่าที่ระบบนี้ใช้จริง
 *
 * สคริปต์ของ Google ถูกโหลดจาก CDN ตอนรันไทม์ ไม่ได้มากับ npm จึงไม่มี type
 * ติดมาด้วย — เดิมทั้งสองหน้าจอที่ใช้แผนที่จึงประกาศ `declare const google: any`
 * แล้วเรียกอะไรก็ได้โดยไม่มีอะไรตรวจ พิมพ์ชื่อเมธอดผิดจะรู้ตอนกดใช้จริงเท่านั้น
 *
 * ไฟล์นี้ประกาศเฉพาะส่วนที่ใช้ (แผนที่ · หมุด · กล่องข้อความ · ค้นหาพิกัด ·
 * ช่องกรอกที่อยู่แบบเติมอัตโนมัติ) **จงใจไม่ลง `@types/google.maps` ทั้งก้อน**
 * เพราะมันครอบ API ทั้งหมดที่โปรเจคไม่ได้แตะเลยสักส่วน
 *
 * เพิ่มการเรียกใช้ใหม่เมื่อไหร่ ต้องมาเติมชนิดที่นี่ — ซึ่งเป็นเรื่องดี
 * เพราะมันบังคับให้รู้ตัวว่ากำลังพึ่งพา API ภายนอกเพิ่มอีกชิ้น
 */

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface GoogleLatLng {
  lat(): number;
  lng(): number;
}

export interface GoogleGeometry {
  location?: GoogleLatLng;
}

/** ชิ้นส่วนที่อยู่ที่ Google แยกให้ เช่น จังหวัด อำเภอ รหัสไปรษณีย์ */
export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GeocoderResult {
  geometry?: GoogleGeometry;
  formatted_address?: string;
  address_components?: AddressComponent[];
}

/** ผลลัพธ์จากช่องกรอกที่อยู่แบบเติมอัตโนมัติ */
export interface PlaceResult extends GeocoderResult {
  name?: string;
  place_id?: string;
}

export interface GoogleMap {
  setCenter(position: LatLngLiteral | GoogleLatLng): void;
  setZoom(zoom: number): void;
  fitBounds(bounds: LatLngBounds): void;
}

export interface LatLngBounds {
  extend(position: LatLngLiteral | GoogleLatLng): void;
  isEmpty(): boolean;
}

export interface MapMarker {
  addListener(event: string, handler: () => void): unknown;
  setMap(map: GoogleMap | null): void;
}

export interface InfoWindow {
  open(map: GoogleMap, marker: MapMarker): void;
  close(): void;
  setContent(content: string): void;
}

export interface Geocoder {
  geocode(
    request: { address: string },
    callback: (results: GeocoderResult[] | null, status: string) => void
  ): void;
}

export interface PlacesAutocomplete {
  addListener(event: 'place_changed', handler: () => void): unknown;
  getPlace(): PlaceResult;
}

/** ผิวสัมผัสของ `window.google` เท่าที่โปรเจคเรียกใช้ */
export interface GoogleMapsApi {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
    Marker: new (options: Record<string, unknown>) => MapMarker;
    InfoWindow: new (options?: Record<string, unknown>) => InfoWindow;
    Geocoder: new () => Geocoder;
    LatLngBounds: new () => LatLngBounds;
    Animation: { DROP: unknown };
    event: { removeListener(listener: unknown): void };
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        options?: Record<string, unknown>
      ) => PlacesAutocomplete;
    };
  };
}

/**
 * Google Identity Services — คนละสคริปต์กับ Maps แต่แขวนอยู่ใต้ `window.google`
 * ตัวเดียวกัน · ใช้เฉพาะปุ่ม "เข้าสู่ระบบด้วย Google" ใน `useGoogleSignIn`
 */
export interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }): void;
      renderButton(container: HTMLElement, options: Record<string, unknown>): void;
      prompt?(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleMapsApi & Partial<GoogleIdentityApi>;
  }
}

/** อ่าน API ของ Google จาก window แบบที่ TypeScript ตรวจให้ได้ */
export const googleMaps = (): GoogleMapsApi['maps'] | undefined => window.google?.maps;
