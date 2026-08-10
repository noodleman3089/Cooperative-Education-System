export interface SubdistrictItem {
  name: string;
  zipcode: string;
}

export interface DistrictItem {
  name: string;
  subdistricts: SubdistrictItem[];
}

export interface ProvinceItem {
  name: string;
  districts: DistrictItem[];
}

let cache: ProvinceItem[] | null = null;
let inFlight: Promise<ProvinceItem[]> | null = null;

/**
 * Every province, district and subdistrict in Thailand — 2 MB of JSON, which is
 * larger than the rest of the application put together. It used to be a plain
 * `import` at the top of this file, so it rode into the main bundle and every
 * user of every role downloaded it before the login page could render, to fill
 * in three dropdowns on one screen.
 *
 * Now it arrives only when a form actually needs it. The parsed result is kept
 * so reopening the form does not re-parse 2 MB.
 */
export async function loadThaiAddressData(): Promise<ProvinceItem[]> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = import('./thai_geography.json').then(({ default: rawData }) => {
      cache = (rawData as any[]).map((prov) => ({
        name: prov.name_th,
        districts: (prov.districts || []).map((dist: any) => ({
          name: dist.name_th,
          subdistricts: (dist.sub_districts || []).map((sub: any) => ({
            name: sub.name_th,
            zipcode: sub.zip_code ? String(sub.zip_code) : '',
          })),
        })),
      }));
      return cache;
    });
  }
  return inFlight;
}
