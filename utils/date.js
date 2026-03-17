/**
 * Parse a DD/MM/YYYY string to ISO date string YYYY-MM-DD.
 * Returns null if the input is blank or unparseable.
 */
export function parseDMY(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  if (!day || !month || !year || year.length !== 4) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Format an ISO string, Date object, or DD/MM/YYYY string for display.
 * Always returns DD/MM/YYYY.
 */
export function formatForDisplay(dateStr) {
  if (!dateStr) return 'N/A';
  if (typeof dateStr === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  } catch {
    return String(dateStr);
  }
}

/**
 * Returns true if the ISO date string is within `days` days from today.
 */
export function isExpiringSoon(isoDateStr, days = 30) {
  if (!isoDateStr) return false;
  const expiry = new Date(isoDateStr);
  const now = new Date();
  const diffMs = expiry - now;
  return diffMs >= 0 && diffMs <= days * 24 * 60 * 60 * 1000;
}

// Indian vehicle number: 2 letters + 1-2 digits + 1-3 letters + 4 digits (spaces optional)
const VEHICLE_RE = /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{4}$/;

// Indian mobile: exactly 10 digits, starts with 6-9
const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Format a raw PUC scrape record into a clean object ready for backend/sheets submission.
 * Throws if vehicle number or mobile (when provided) have invalid format.
 */
export function formatRecordForBackend(record) {
  // Normalise vehicle number: uppercase, collapse whitespace
  const vehicleNo = String(record.vehicleNo || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!VEHICLE_RE.test(vehicleNo)) {
    throw new Error(`Invalid vehicle number: "${vehicleNo}"`);
  }

  // Mobile is optional — validate only when present
  const mobile = record.mobile ? String(record.mobile).replace(/\D/g, '') : null;
  if (mobile !== null && !MOBILE_RE.test(mobile)) {
    throw new Error('Invalid mobile number — must be 10 digits starting with 6–9');
  }

  const validFrom = parseDMY(record.validDate);
  let validUpto   = parseDMY(record.uptoDate);
  if (!validUpto && validFrom) validUpto = validFrom;

  // Rate: strip everything except digits and one decimal point, then floor
  const rawRate   = String(record.rate || '0').replace(/[^0-9.]/g, '');
  const cleanRate = Math.floor(Number(rawRate)) || 0;
  if (cleanRate < 0 || cleanRate > 100000) {
    throw new Error(`Implausible rate value: ${cleanRate}`);
  }

  const outcome    = record.outcome === 'FAIL' ? 'FAIL' : 'PASS';
  const failReason = outcome === 'FAIL' ? (record.failReason || null) : null;

  return {
    vehicleNo,
    mobile,
    validFrom,
    validUpto,
    rate:      cleanRate,
    outcome,
    failReason,
    verified:  false,
  };
}
