/**
 * Chuyển đổi một chuỗi ISO hoặc Date object thành định dạng `YYYY-MM-DDTHH:mm`
 * để hiển thị chính xác theo giờ địa phương (local timezone) trên thẻ <input type="datetime-local">.
 */
export const formatToDatetimeLocal = (value?: string | Date | null): string => {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  const str = String(value).trim();
  if (!str) return '';
  
  // Nếu đã là định dạng YYYY-MM-DDTHH:mm cục bộ (không có múi giờ Z hay +HH:mm)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;

  try {
    const standardStr = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
    const d = new Date(standardStr);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const YYYY = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const DD = pad(d.getDate());
    const HH = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${YYYY}-${MM}-${DD}T${HH}:${mm}`;
  } catch {
    return '';
  }
};

/**
 * Chuẩn hóa thời gian từ input datetime-local hoặc bất kỳ định dạng nào sang chuỗi ISO 8601 UTC (.toISOString())
 * để lưu vào PostgreSQL TIMESTAMPTZ hoặc Firestore.
 * Tránh việc PostgreSQL / Supabase hiểu lầm chuỗi không có múi giờ thành UTC làm lệch 7 tiếng ở Việt Nam (+7h).
 */
export const normalizeDateTimeForStorage = (val?: string | Date | null): string | null => {
  if (!val) return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val.toISOString();
  }
  const str = String(val).trim();
  if (!str) return null;

  try {
    // Chuẩn hóa khoảng trắng thành T nếu cần (VD: "2026-09-09 00:41:00")
    const standardStr = str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str;
    const d = new Date(standardStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {}
  return null;
};
